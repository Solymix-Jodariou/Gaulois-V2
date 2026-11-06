-- Les dons copiés à la main.
--
-- Décision du 6 novembre 2026 : sans attendre un accès donné par OpenFront, un officier peut coller
-- dans /admin la liste des dons qu'il a copiée à la main depuis son propre navigateur. Ni robot, ni
-- script : voir docs/CONQUETE.md. Le navigateur lit ce texte et n'envoie que le montant, la date et
-- une empreinte du donneur, comme le fera la tâche planifiée le jour où OpenFront donnera une clé.
--
-- Le serveur ne peut pas vérifier que la copie est fidèle : il fait à l'officier la même confiance
-- que pour un don saisi à la main, et chaque import reste au journal.

-- La première lecture peut désormais venir d'une copie à la main : son motif ne dit plus « automatique ».
create or replace function internal.begin_donation_sync() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if internal.donations_synced() then return; end if;
  insert into public.file_cleanup (path)
  select screenshot_path from public.donations where screenshot_path is not null
  on conflict (path) do nothing;
  update public.donations
  set status = case when status = 'approved' then 'superseded'::public.donation_status else 'cancelled'::public.donation_status end,
    reason = 'Remplacé par la lecture de la liste des dons d''OpenFront.',
    reviewed_at = now(),
    screenshot_path = null
  where status in ('pending', 'approved');
  update public.profiles set capsules_total = 0 where capsules_total <> 0;
  insert into public.app_state (key, value) values ('donations_sync', jsonb_build_object('since', now(), 'read_at', now()));
end $$;

-- Une ligne venue du navigateur : le format de la table `openfront_donations`, et aucun don venu du futur.
create function internal.valid_ledger_row(p_row jsonb) returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_row) is distinct from 'object' then return false; end if;
  if coalesce(p_row ->> 'id', '') !~ '^[0-9]{1,40}$' then return false; end if;
  if p_row ->> 'hash' is not null and p_row ->> 'hash' !~ '^[0-9a-f]{64}$' then return false; end if;
  if coalesce(p_row ->> 'capsules', '') !~ '^[0-9]{1,10}$' then return false; end if;
  if (p_row ->> 'capsules')::bigint not between 1 and 1000000000 then return false; end if;
  if coalesce(p_row ->> 'at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
  return (p_row ->> 'at')::timestamptz <= now() + interval '5 minutes';
exception when datetime_field_overflow or invalid_datetime_format then
  return false;
end $$;

revoke all on function internal.valid_ledger_row(jsonb) from public, anon, authenticated;

-- Tout ou rien, comme `ingest_openfront_donations`, qui fait le reste : relire un don n'ajoute rien.
-- Une copie partielle convient une fois la première lecture faite. La première, elle, ferme les
-- déclarations et remet les totaux à zéro pour de bon : elle exige la liste complète, un admin
-- et une confirmation.
create function public.import_openfront_donations(p_rows jsonb, p_expected integer default null, p_first_read boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_size integer;
  v_received integer;
  v_first boolean;
  v_result jsonb;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if jsonb_typeof(p_rows) is distinct from 'array' then perform internal.fail('invalid_donations'); end if;
    v_size := jsonb_array_length(p_rows);
    if v_size = 0 then perform internal.fail('invalid_donations'); end if;
    if v_size > 2000 then perform internal.fail('too_many_donations', jsonb_build_object('limit', 2000)); end if;
    if exists (select 1 from jsonb_array_elements(p_rows) r where not internal.valid_ledger_row(r.value)) then
      perform internal.fail('invalid_donations');
    end if;

    -- Le verrou du jeu d'abord, comme toutes les actions. Le second : deux premières lectures ne se croisent pas.
    perform internal.lock_open_season();
    perform pg_advisory_xact_lock(727003, 0);

    v_first := not internal.donations_synced();
    if v_first then
      perform internal.require_rank(3);
      if p_first_read is not true then perform internal.fail('first_read_unconfirmed'); end if;
      select count(distinct r.value ->> 'id') into v_received from jsonb_array_elements(p_rows) r;
      if p_expected is null or v_received < p_expected then
        perform internal.fail('first_read_incomplete', jsonb_build_object('received', v_received, 'expected', p_expected));
      end if;
      perform internal.begin_donation_sync();
      -- Un don fait entre la copie et cet envoi n'y figure pas : il donnera ses troupes à la lecture suivante.
      update public.app_state
      set value = value || jsonb_build_object('since', (select max((r.value ->> 'at')::timestamptz) from jsonb_array_elements(p_rows) r) + interval '1 millisecond'),
        updated_at = now()
      where key = 'donations_sync';
    end if;

    v_result := public.ingest_openfront_donations(p_rows);
    perform internal.log_admin(v_actor, 'donations_imported', null, jsonb_build_object('new', v_result -> 'new', 'known', v_result -> 'known', 'first_read', v_first));
    return v_result || jsonb_build_object('first_read', v_first, 'ledger', (select count(*) from public.openfront_donations));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

revoke all on function public.import_openfront_donations(jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.import_openfront_donations(jsonb, integer, boolean) to authenticated;

-- Où en est la liste : pour savoir jusqu'où recopier.
create function public.get_donation_import_state() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_detail text;
begin
  perform internal.require_rank(2);
  return jsonb_build_object(
    'ok', true,
    'synced', internal.donations_synced(),
    'read_at', (select value ->> 'read_at' from public.app_state where key = 'donations_sync'),
    'known', (select count(*) from public.openfront_donations),
    'newest_at', (select max(donated_at) from public.openfront_donations)
  );
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

revoke all on function public.get_donation_import_state() from public, anon, authenticated;
grant execute on function public.get_donation_import_state() to authenticated;
