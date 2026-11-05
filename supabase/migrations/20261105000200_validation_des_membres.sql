-- Étape 2 : lier un profil OpenFront et valider les membres.
--
-- La liste des membres est publique : taper l'identifiant d'un membre ne prouve pas qu'on
-- est ce membre. La liste sert donc de contrôle automatique, et un officier décide.

create table public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Copie de la liste officielle, écrite par la collecte. Seules des empreintes y sont gardées :
-- le publicId d'un membre, même anonyme, n'entre jamais dans la base.
create table public.clan_roster (
  public_id_hash text primary key,
  username text,
  game_role text not null
);
create index clan_roster_username on public.clan_roster (lower(username));

create type public.request_status as enum ('pending', 'approved', 'refused', 'cancelled');

create table public.membership_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  openfront_hash text not null,
  -- Ce que le joueur a tapé, seulement s'il n'a pas été reconnu comme un identifiant de la liste.
  claimed_text text,
  roster_username text,
  in_roster boolean not null,
  note text,
  status public.request_status not null default 'pending',
  reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index membership_one_open on public.membership_requests (user_id) where status = 'pending';
create index membership_by_status on public.membership_requests (status, created_at);

create function internal.hash_public_id(p_id text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_id, 'UTF8')), 'hex')
$$;

/* ---------- La collecte met la liste à jour ---------- */

-- Réservée à la clé de service. Une liste incomplète ne remplace jamais la dernière liste valide.
create function public.sync_clan_roster(p_entries jsonb, p_total integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_entries) <> 'array' or p_total is null or p_total < 1 or jsonb_array_length(p_entries) <> p_total then
    return internal.error_json('roster_incomplete', '');
  end if;
  delete from public.clan_roster where true;
  insert into public.clan_roster (public_id_hash, username, game_role)
  select distinct on (e ->> 'hash') e ->> 'hash', nullif(e ->> 'username', ''), coalesce(e ->> 'role', 'member')
  from jsonb_array_elements(p_entries) e
  where coalesce(e ->> 'hash', '') <> '';
  insert into public.app_state (key, value) values ('roster', jsonb_build_object('total', p_total, 'read_at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'total', p_total);
end $$;

/* ---------- Le joueur demande sa validation ---------- */

create function public.request_membership(p_claim text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_claim text := btrim(coalesce(p_claim, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_hash text := internal.hash_public_id(btrim(coalesce(p_claim, '')));
  v_entry public.clan_roster;
  v_matches integer;
  v_by_id boolean := false;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    if v_uid is null then perform internal.fail('not_signed_in'); end if;
    select * into v_profile from public.profiles where user_id = v_uid;
    if not found then perform internal.fail('not_signed_in'); end if;
    if v_profile.status = 'suspended' then perform internal.fail('suspended'); end if;
    if v_profile.status = 'validated' then perform internal.fail('already_validated'); end if;
    if char_length(v_claim) not between 1 and 64 then perform internal.fail('invalid_claim'); end if;
    if char_length(coalesce(v_note, '')) > 300 then perform internal.fail('invalid_note'); end if;
    if exists (select 1 from public.membership_requests where user_id = v_uid and status = 'pending') then
      perform internal.fail('request_open');
    end if;

    -- D'abord l'identifiant public, puis le pseudo.
    select * into v_entry from public.clan_roster where public_id_hash = v_hash;
    if found then
      v_by_id := true;
    else
      select count(*) into v_matches from public.clan_roster where lower(username) = lower(v_claim);
      if v_matches > 1 then perform internal.fail('ambiguous_pseudo'); end if;
      if v_matches = 1 then
        select * into v_entry from public.clan_roster where lower(username) = lower(v_claim);
      end if;
    end if;

    if v_entry.public_id_hash is not null then
      v_hash := v_entry.public_id_hash;
    end if;
    if exists (select 1 from public.private_links where openfront_hash = v_hash) then
      perform internal.fail('already_linked');
    end if;

    insert into public.membership_requests (user_id, openfront_hash, claimed_text, roster_username, in_roster, note)
    values (
      v_uid,
      v_hash,
      case when v_by_id then null else v_claim end,
      v_entry.username,
      v_entry.public_id_hash is not null,
      v_note
    );
    return jsonb_build_object('ok', true, 'in_roster', v_entry.public_id_hash is not null, 'roster_username', v_entry.username);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.cancel_membership_request() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return internal.error_json('not_signed_in', ''); end if;
  update public.membership_requests set status = 'cancelled', decided_at = now()
  where user_id = v_uid and status = 'pending';
  if not found then return internal.error_json('no_open_request', ''); end if;
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Un officier décide ---------- */

create function public.list_membership_requests(p_status public.request_status default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows jsonb;
  v_detail text;
begin
  perform internal.require_rank(2);
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select r.id, p.gaul_number as number, p.display_name as name, l.discord_name, l.discord_id,
      r.in_roster, r.roster_username, r.claimed_text, r.note, r.status, r.reason, r.created_at, r.decided_at,
      -- Le rang dans le jeu, pour aider l'officier. La liste est publique : il ne donne aucun droit.
      (select c.game_role from public.clan_roster c where c.public_id_hash = r.openfront_hash) as game_role
    from public.membership_requests r
    join public.profiles p on p.user_id = r.user_id
    left join public.private_links l on l.user_id = r.user_id
    where r.status = p_status
    order by r.created_at
    limit 200
  ) t;
  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'roster', (select value from public.app_state where key = 'roster')
  );
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

create function public.review_membership(p_request bigint, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_request public.membership_requests;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if char_length(coalesce(v_reason, '')) > 300 then perform internal.fail('invalid_reason'); end if;
    select * into v_request from public.membership_requests where id = p_request for update;
    if not found then perform internal.fail('request_not_found'); end if;
    if v_request.status <> 'pending' then perform internal.fail('request_closed'); end if;

    if not p_approve then
      update public.membership_requests
      set status = 'refused', reason = v_reason, decided_by = v_actor, decided_at = now()
      where id = p_request;
      perform internal.log_admin(v_actor, 'membership_refused', v_request.user_id, jsonb_build_object('reason', v_reason));
      return jsonb_build_object('ok', true);
    end if;

    if exists (select 1 from public.private_links where openfront_hash = v_request.openfront_hash) then
      perform internal.fail('already_linked');
    end if;

    update public.membership_requests
    set status = 'approved', reason = v_reason, decided_by = v_actor, decided_at = now()
    where id = p_request;
    update public.private_links
    set openfront_hash = v_request.openfront_hash, openfront_username = v_request.roster_username, linked_at = now()
    where user_id = v_request.user_id;
    -- Le pseudo public de la liste devient le nom de jeu. Sans pseudo public, le joueur reste « Gaulois n° … ».
    update public.profiles
    set status = 'validated', validated_at = now(), status_reason = null, display_name = coalesce(left(v_request.roster_username, 64), display_name)
    where user_id = v_request.user_id;
    -- Un seul compte par joueur OpenFront : les autres demandes pour ce joueur se ferment.
    update public.membership_requests
    set status = 'refused', reason = 'Ce joueur OpenFront est déjà lié à un autre compte.', decided_by = v_actor, decided_at = now()
    where openfront_hash = v_request.openfront_hash and status = 'pending';
    -- Ses dons déjà lus chez OpenFront lui reviennent, maintenant qu'on sait qui il est.
    perform internal.credit_openfront_ledger(v_request.user_id);
    perform internal.log_admin(v_actor, 'membership_approved', v_request.user_id, jsonb_build_object('in_roster', v_request.in_roster));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Ce que voit chacun ---------- */

create function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_link public.private_links;
  v_request jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', true, 'signed_in', false); end if;
  select * into v_profile from public.profiles where user_id = v_uid;
  if not found then return jsonb_build_object('ok', true, 'signed_in', false); end if;
  select * into v_link from public.private_links where user_id = v_uid;
  select to_jsonb(t) into v_request from (
    select r.id, r.status, r.reason, r.in_roster, r.roster_username, r.created_at, r.decided_at
    from public.membership_requests r
    where r.user_id = v_uid
    order by r.id desc
    limit 1
  ) t;
  return jsonb_build_object(
    'ok', true,
    'signed_in', true,
    'number', v_profile.gaul_number,
    'name', v_profile.display_name,
    'role', v_profile.role,
    'status', v_profile.status,
    'status_reason', v_profile.status_reason,
    'rank', internal.current_rank(),
    'anonymous', v_profile.anonymous_donations,
    'capsules', v_profile.capsules_total,
    'discord_name', v_link.discord_name,
    'openfront_username', v_link.openfront_username,
    'linked', v_link.openfront_hash is not null,
    'request', v_request
  );
end $$;

-- Pour les officiers : retrouver un membre, ses capsules, sa présence dans la liste.
create function public.list_members(p_search text default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows jsonb;
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v_detail text;
begin
  perform internal.require_rank(2);
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select p.user_id, p.gaul_number as number, p.display_name as name, p.role, p.status, p.status_reason,
      p.capsules_total as capsules, l.discord_name, l.openfront_username,
      (l.openfront_hash is not null and exists (select 1 from public.clan_roster c where c.public_id_hash = l.openfront_hash)) as in_roster,
      l.openfront_hash is not null as linked,
      p.created_at, p.validated_at
    from public.profiles p
    left join public.private_links l on l.user_id = p.user_id
    where v_search is null
      or lower(p.display_name) like '%' || v_search || '%'
      or lower(coalesce(l.discord_name, '')) like '%' || v_search || '%'
      or lower(coalesce(l.openfront_username, '')) like '%' || v_search || '%'
    order by p.status, p.display_name
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) t;
  return jsonb_build_object('ok', true, 'rows', v_rows);
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

/* ---------- Règles d'accès ---------- */

alter table public.app_state enable row level security;
alter table public.clan_roster enable row level security;
alter table public.membership_requests enable row level security;

revoke all on public.app_state, public.clan_roster, public.membership_requests from anon, authenticated;

grant select on public.membership_requests to authenticated;
create policy membership_read on public.membership_requests for select to authenticated
  using (user_id = auth.uid() or internal.current_rank() >= 2);
