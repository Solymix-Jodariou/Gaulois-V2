-- Étape 3 : les dons de capsules.
--
-- L'API d'OpenFront réserve les dons aux membres connectés, et ses conditions interdisent de les
-- lire avec une session de joueur : ils ne peuvent pas être collectés sans son accord.
-- Un membre déclare, un officier vérifie dans l'onglet Dons du jeu et valide ou refuse.
-- Seul un don validé compte. Aucun chiffre n'est inventé ni estimé.
-- Si OpenFront ouvre un accès, ses dons remplacent les déclarations : voir …_dons_en_troupes.sql.

-- `superseded` : un don déclaré à la main, remplacé par la lecture automatique des dons.
create type public.donation_status as enum ('pending', 'approved', 'refused', 'cancelled', 'superseded');
-- `opening` : total de départ recopié par un officier pour les dons d'avant l'ouverture du site.
create type public.donation_kind as enum ('donation', 'opening');

create table public.donations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  capsules bigint not null check (capsules between 1 and 1000000000),
  donated_on date not null,
  kind public.donation_kind not null default 'donation',
  screenshot_path text,
  note text check (char_length(note) <= 300),
  status public.donation_status not null default 'pending',
  created_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  reason text check (char_length(reason) <= 300),
  -- Les troupes que ce don a données, et dans quelle saison : pour les reprendre s'il est annulé.
  troops_granted bigint not null default 0 check (troops_granted >= 0),
  troops_season bigint,
  created_at timestamptz not null default now()
);
create index donations_by_user on public.donations (user_id, status);
create index donations_pending on public.donations (created_at) where status = 'pending';

-- Le grand livre des dons lus chez OpenFront, ligne par ligne. Il reste vide tant qu'OpenFront
-- n'a pas donné d'accès. Du donneur, on ne garde qu'une empreinte : jamais son publicId ni son pseudo.
create table public.openfront_donations (
  ledger_id text primary key check (ledger_id ~ '^[0-9]{1,40}$'),
  donor_hash text check (donor_hash ~ '^[0-9a-f]{64}$'),
  capsules bigint not null check (capsules between 1 and 1000000000),
  donated_at timestamptz not null,
  donation_id bigint references public.donations (id) on delete set null,
  read_at timestamptz not null default now()
);
create index openfront_donations_to_credit on public.openfront_donations (donor_hash) where donation_id is null;
create index openfront_donations_recent on public.openfront_donations (donated_at desc);

-- Les captures à effacer de l'espace de fichiers, une fois la décision prise.
create table public.file_cleanup (
  path text primary key,
  queued_at timestamptz not null default now()
);

/* ---------- Une même demande envoyée deux fois n'agit qu'une fois ---------- */

create function internal.replay(p_request uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_row public.action_requests;
begin
  if p_request is null then perform internal.fail('invalid_request'); end if;
  select * into v_row from public.action_requests where request_id = p_request;
  if not found then return null; end if;
  if v_row.user_id <> p_user then perform internal.fail('invalid_request'); end if;
  return v_row.result;
end $$;

create function internal.remember(p_request uuid, p_user uuid, p_result jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  insert into public.action_requests (request_id, user_id, result) values (p_request, p_user, p_result);
  select p_result;
$$;

/* ---------- Le membre déclare ---------- */

create function public.declare_donation(
  p_request_id uuid,
  p_capsules bigint,
  p_donated_on date,
  p_screenshot_path text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_previous jsonb;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_path text := nullif(btrim(coalesce(p_screenshot_path, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    if p_request_id is null then perform internal.fail('invalid_request'); end if;
    perform pg_advisory_xact_lock(727002, hashtext(p_request_id::text));
    v_previous := internal.replay(p_request_id, v_uid);
    if v_previous is not null then return v_previous; end if;

    if internal.donations_synced() then perform internal.fail('donations_synced'); end if;
    if p_capsules is null or p_capsules not between 1 and 1000000000 then perform internal.fail('invalid_capsules'); end if;
    if p_donated_on is null or p_donated_on > v_today or p_donated_on < v_today - 365 then perform internal.fail('invalid_date'); end if;
    if char_length(coalesce(v_note, '')) > 300 then perform internal.fail('invalid_note'); end if;
    if v_path is not null then
      -- Une capture n'appartient qu'au dossier de son auteur.
      if v_path not like v_uid::text || '/%' or char_length(v_path) > 200 then perform internal.fail('invalid_screenshot'); end if;
      if not exists (select 1 from storage.objects where bucket_id = 'donation-proofs' and name = v_path) then
        perform internal.fail('invalid_screenshot');
      end if;
    end if;
    if (select count(*) from public.donations where user_id = v_uid and status = 'pending') >= 20 then
      perform internal.fail('too_many_pending');
    end if;

    insert into public.donations (user_id, capsules, donated_on, screenshot_path, note, created_by)
    values (v_uid, p_capsules, p_donated_on, v_path, v_note, v_uid)
    returning id into v_id;
    return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'id', v_id));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.get_my_donations() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_rows jsonb;
  v_detail text;
begin
  v_uid := internal.require_rank(1);
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select d.id, d.capsules, d.donated_on, d.kind, d.status, d.reason, d.note, d.created_at, d.reviewed_at, d.troops_granted
    from public.donations d
    where d.user_id = v_uid
    order by d.created_at desc
    limit 200
  ) t;
  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'total', (select capsules_total from public.profiles where user_id = v_uid),
    'synced', internal.donations_synced(),
    -- Combien de troupes vaut une capsule dans la saison en cours : rien s'il n'y en a pas.
    'troops_per_capsule', (select (config ->> 'troopsPerCapsule')::float8 from public.seasons where status in ('expansion', 'war') limit 1)
  );
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

create function public.set_donation_anonymity(p_anonymous boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    if p_anonymous is null then perform internal.fail('invalid_request'); end if;
    update public.profiles set anonymous_donations = p_anonymous where user_id = v_uid;
    return jsonb_build_object('ok', true, 'anonymous', p_anonymous);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- L'officier décide ou saisit ---------- */

create function public.list_donations(p_status public.donation_status default 'pending', p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_rows jsonb;
  v_detail text;
begin
  v_actor := internal.require_rank(2);
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select d.id, p.gaul_number as number, p.display_name as name, d.capsules, d.donated_on, d.kind, d.note,
      d.screenshot_path, d.status, d.reason, d.created_at, d.reviewed_at, d.troops_granted,
      d.user_id <> v_actor as can_review
    from public.donations d
    join public.profiles p on p.user_id = d.user_id
    where d.status = p_status
    order by d.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 300)
  ) t;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'synced', internal.donations_synced());
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

create function public.review_donation(p_donation bigint, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.donations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_troops bigint := 0;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if char_length(coalesce(v_reason, '')) > 300 then perform internal.fail('invalid_reason'); end if;
    -- Le verrou du jeu d'abord, comme toutes les actions : un don ne croise jamais une attaque.
    perform internal.lock_open_season();
    select * into v_row from public.donations where id = p_donation for update;
    if not found then perform internal.fail('donation_not_found'); end if;
    if v_row.status <> 'pending' then perform internal.fail('donation_closed'); end if;
    -- Personne ne valide ses propres dons.
    if v_row.user_id = v_actor then perform internal.fail('not_on_yourself'); end if;

    update public.donations
    set status = case when p_approve then 'approved'::public.donation_status else 'refused'::public.donation_status end,
      reviewed_by = v_actor, reviewed_at = now(), reason = v_reason, screenshot_path = null
    where id = p_donation;
    if p_approve then
      update public.profiles set capsules_total = capsules_total + v_row.capsules where user_id = v_row.user_id;
      -- Le don arrive tout de suite en renfort, si son auteur joue.
      v_troops := internal.grant_donation_troops(p_donation);
    end if;
    -- La capture ne sert plus : elle part à l'effacement.
    if v_row.screenshot_path is not null then
      insert into public.file_cleanup (path) values (v_row.screenshot_path) on conflict (path) do nothing;
    end if;
    perform internal.log_admin(
      v_actor,
      case when p_approve then 'donation_approved' else 'donation_refused' end,
      v_row.user_id,
      jsonb_build_object('donation', v_row.id, 'capsules', v_row.capsules, 'reason', v_reason, 'troops', v_troops)
    );
    return jsonb_build_object('ok', true, 'removed_path', v_row.screenshot_path, 'troops', v_troops);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

-- `opening` recopie le total d'avant l'ouverture du site : il compte au total, pas dans la saison.
create function public.enter_donation(
  p_request_id uuid,
  p_user uuid,
  p_capsules bigint,
  p_donated_on date,
  p_kind public.donation_kind default 'donation',
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_previous jsonb;
  v_status public.member_status;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id bigint;
  v_troops bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if p_request_id is null then perform internal.fail('invalid_request'); end if;
    perform internal.lock_open_season();
    perform pg_advisory_xact_lock(727002, hashtext(p_request_id::text));
    v_previous := internal.replay(p_request_id, v_actor);
    if v_previous is not null then return v_previous; end if;

    if internal.donations_synced() then perform internal.fail('donations_synced'); end if;
    if p_user = v_actor then perform internal.fail('not_on_yourself'); end if;
    select status into v_status from public.profiles where user_id = p_user for update;
    if not found then perform internal.fail('user_not_found'); end if;
    if v_status <> 'validated' then perform internal.fail('target_not_validated'); end if;
    if p_capsules is null or p_capsules not between 1 and 1000000000 then perform internal.fail('invalid_capsules'); end if;
    if p_donated_on is null or p_donated_on > v_today then perform internal.fail('invalid_date'); end if;
    if char_length(coalesce(v_note, '')) > 300 then perform internal.fail('invalid_note'); end if;

    insert into public.donations (user_id, capsules, donated_on, kind, note, status, created_by, reviewed_by, reviewed_at)
    values (p_user, p_capsules, p_donated_on, coalesce(p_kind, 'donation'), v_note, 'approved', v_actor, v_actor, now())
    returning id into v_id;
    update public.profiles set capsules_total = capsules_total + p_capsules where user_id = p_user;
    v_troops := internal.grant_donation_troops(v_id);
    perform internal.log_admin(v_actor, 'donation_entered', p_user, jsonb_build_object('donation', v_id, 'capsules', p_capsules, 'kind', coalesce(p_kind, 'donation'), 'troops', v_troops));
    return internal.remember(p_request_id, v_actor, jsonb_build_object('ok', true, 'id', v_id, 'troops', v_troops));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

-- Pour corriger une erreur : le don validé ne compte plus, ses troupes repartent, et la trace reste.
create function public.cancel_donation(p_donation bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.donations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_taken bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if v_reason is null or char_length(v_reason) > 300 then perform internal.fail('invalid_reason'); end if;
    if internal.donations_synced() then perform internal.fail('donations_synced'); end if;
    perform internal.lock_open_season();
    select * into v_row from public.donations where id = p_donation for update;
    if not found then perform internal.fail('donation_not_found'); end if;
    if v_row.status <> 'approved' then perform internal.fail('donation_closed'); end if;
    if v_row.user_id = v_actor then perform internal.fail('not_on_yourself'); end if;
    update public.donations set status = 'cancelled', reviewed_by = v_actor, reviewed_at = now(), reason = v_reason where id = p_donation;
    update public.profiles set capsules_total = capsules_total - v_row.capsules where user_id = v_row.user_id;
    v_taken := internal.take_back_donation_troops(v_row);
    perform internal.log_admin(v_actor, 'donation_cancelled', v_row.user_id, jsonb_build_object('donation', v_row.id, 'capsules', v_row.capsules, 'reason', v_reason, 'troops_taken', v_taken));
    return jsonb_build_object('ok', true, 'troops_taken', v_taken);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Le classement public ---------- */

create function public.get_donor_ranking() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_season record;
  v_since date;
  v_recent date := (now() at time zone 'Europe/Paris')::date - 30;
  v_rows jsonb;
begin
  select id, name, started_at into v_season from public.seasons
  where status in ('expansion', 'war') order by id desc limit 1;
  v_since := (v_season.started_at at time zone 'Europe/Paris')::date;

  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select
      rank() over (order by p.capsules_total desc) as rank,
      -- Un membre anonyme n'apparaît ni sous son nom ni sous son numéro.
      case when p.anonymous_donations then null else p.display_name end as name,
      p.capsules_total as total,
      case when v_since is null then null else coalesce(sum(d.capsules) filter (where d.kind = 'donation' and internal.in_season(d.donated_on, d.created_at, v_season.started_at)), 0) end as season,
      coalesce(sum(d.capsules) filter (where d.kind = 'donation' and d.donated_on >= v_recent), 0) as recent,
      coalesce(p.user_id = v_uid, false) as me
    from public.profiles p
    left join public.donations d on d.user_id = p.user_id and d.status = 'approved'
    where p.status = 'validated' and p.capsules_total > 0
    group by p.user_id
    order by p.capsules_total desc, p.gaul_number
    limit 500
  ) t;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'season', v_season.name,
    -- Tant qu'OpenFront n'a pas donné d'accès, rien ici : les dons sont déclarés et validés à la main.
    'sync', (select value from public.app_state where key = 'donations_sync'),
    'read_at', now()
  );
end $$;

/* ---------- Effacer son compte ---------- */

create function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role public.site_role;
begin
  if v_uid is null then return internal.error_json('not_signed_in', ''); end if;
  select role into v_role from public.profiles where user_id = v_uid;
  if not found then return internal.error_json('not_signed_in', ''); end if;
  -- Le clan doit garder un fondateur : il transmet d'abord son rôle à la main.
  if v_role = 'founder' then return internal.error_json('founder_cannot_leave', ''); end if;

  perform internal.remove_from_active_season(v_uid, v_uid, 'Compte supprimé');
  -- Le grand livre garde le don, mais plus rien ne le relie à cette personne.
  update public.openfront_donations set donor_hash = null
  where donor_hash = (select openfront_hash from public.private_links where user_id = v_uid);
  insert into public.file_cleanup (path)
  select screenshot_path from public.donations where user_id = v_uid and screenshot_path is not null
  on conflict (path) do nothing;
  perform internal.log_admin(v_uid, 'account_deleted', v_uid);
  delete from auth.users where id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Pour la collecte : effacer les captures qui ne servent plus ---------- */

create function public.list_file_cleanup() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', true, 'paths', coalesce(jsonb_agg(path), '[]')) from (
    select path from public.file_cleanup
    union
    -- Une capture envoyée mais jamais déclarée, oubliée depuis plus d'un jour.
    select o.name from storage.objects o
    where o.bucket_id = 'donation-proofs'
      and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.donations d where d.screenshot_path = o.name)
    limit 500
  ) t
$$;

create function public.confirm_file_cleanup(p_paths jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_paths) <> 'array' then return internal.error_json('invalid_request', ''); end if;
  delete from public.file_cleanup where path in (select jsonb_array_elements_text(p_paths));
  return jsonb_build_object('ok', true);
end $$;

/* ---------- L'espace de fichiers : privé, et limité aux images légères ---------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('donation-proofs', 'donation-proofs', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy donation_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'donation-proofs' and (storage.foldername(name))[1] = auth.uid()::text and internal.current_rank() >= 1);
create policy donation_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'donation-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or internal.current_rank() >= 2));
create policy donation_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'donation-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or internal.current_rank() >= 2));

/* ---------- Règles d'accès ---------- */

alter table public.donations enable row level security;
alter table public.file_cleanup enable row level security;
alter table public.openfront_donations enable row level security;

revoke all on public.donations, public.file_cleanup, public.openfront_donations from anon, authenticated;

grant select on public.donations to authenticated;
create policy donations_read on public.donations for select to authenticated
  using (user_id = auth.uid() or internal.current_rank() >= 2);
