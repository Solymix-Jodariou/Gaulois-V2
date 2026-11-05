-- Étape 1 : comptes, rôles et journal.
--
-- Principe de tout le schéma : le navigateur ne modifie jamais une table. Chaque écriture
-- passe par une fonction `security definer`, qui vérifie l'appelant et les règles.
-- Une fonction répond toujours { ok: true, ... } ou { ok: false, error: "code", detail: ... },
-- pour que le compteur de requêtes reste enregistré même quand l'action est refusée.

create schema if not exists internal;
revoke all on schema internal from public;
-- Les règles d'accès (RLS) appellent internal.current_rank() sous le rôle de l'appelant.
grant usage on schema internal to authenticated;

create type public.site_role as enum ('member', 'officer', 'admin', 'founder');
create type public.member_status as enum ('pending', 'validated', 'suspended');

create sequence public.gaul_numbers;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Le numéro public du joueur : l'identifiant technique du compte n'est jamais montré aux visiteurs.
  gaul_number integer not null unique,
  display_name text not null check (char_length(display_name) between 1 and 64),
  role public.site_role not null default 'member',
  status public.member_status not null default 'pending',
  anonymous_donations boolean not null default true,
  capsules_total bigint not null default 0 check (capsules_total >= 0),
  status_reason text,
  created_at timestamptz not null default now(),
  validated_at timestamptz
);

create table public.private_links (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  discord_id text,
  discord_name text,
  -- Empreinte du publicId : l'identifiant lui-même n'est jamais conservé.
  openfront_hash text unique,
  openfront_username text,
  linked_at timestamptz
);

create table public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  target_id uuid,
  details jsonb not null default '{}'
);

create table public.action_limits (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  minute timestamptz not null,
  count integer not null
);

create table public.action_requests (
  request_id uuid primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);

/* ---------- Outils internes ---------- */

create function internal.fail(p_code text, p_detail jsonb default null) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'GA001', message = p_code, detail = coalesce(p_detail::text, '');
end $$;

create function internal.error_json(p_code text, p_detail text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', p_code, 'detail', nullif(p_detail, '')::jsonb)
$$;

create function internal.rank_of(p_role public.site_role) returns integer
language sql immutable as $$
  select case p_role when 'member' then 1 when 'officer' then 2 when 'admin' then 3 when 'founder' then 4 end
$$;

-- 0 pour un compte non validé. Sert aussi aux règles d'accès, d'où `security definer`.
create function internal.current_rank() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select case when p.status = 'validated' then internal.rank_of(p.role) else 0 end
     from public.profiles p where p.user_id = auth.uid()),
    0)
$$;

-- Vérifie l'appelant et renvoie son identifiant. 1 = membre, 2 = officier, 3 = admin, 4 = fondateur.
create function internal.require_rank(p_min integer) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then perform internal.fail('not_signed_in'); end if;
  select * into v_profile from public.profiles where user_id = v_uid;
  if not found then perform internal.fail('not_signed_in'); end if;
  if v_profile.status = 'suspended' then perform internal.fail('suspended'); end if;
  if v_profile.status <> 'validated' then perform internal.fail('not_validated'); end if;
  if internal.rank_of(v_profile.role) < p_min then perform internal.fail('forbidden'); end if;
  return v_uid;
end $$;

-- Compte une action. Appelée hors du bloc protégé : le compteur reste écrit même si l'action échoue.
create function internal.limit_exceeded(p_limit integer default 30) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_minute timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  if v_uid is null or not exists (select 1 from public.profiles where user_id = v_uid) then return false; end if;
  insert into public.action_limits as a (user_id, minute, count) values (v_uid, v_minute, 1)
  on conflict (user_id) do update
    set count = case when a.minute = excluded.minute then a.count + 1 else 1 end, minute = excluded.minute
  returning count into v_count;
  return v_count > p_limit;
end $$;

create function internal.log_admin(p_actor uuid, p_action text, p_target uuid, p_details jsonb default '{}') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.admin_log (actor_id, action, target_id, details) values (p_actor, p_action, p_target, coalesce(p_details, '{}'))
$$;

-- Le journal ne se réécrit pas, pas même par une fonction.
create function internal.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Le journal ne peut pas être modifié.';
end $$;

create trigger admin_log_append_only before update or delete on public.admin_log
  for each row execute function internal.forbid_change();

/* ---------- Création d'un compte à la première connexion ---------- */

create function internal.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_number integer := nextval('public.gaul_numbers');
begin
  insert into public.profiles (user_id, gaul_number, display_name)
  values (new.id, v_number, 'Gaulois n° ' || v_number);
  insert into public.private_links (user_id, discord_id, discord_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function internal.handle_new_user();

-- Un pseudo Discord change : les officiers voient le dernier connu.
create function internal.handle_user_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.private_links
  set discord_name = coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', discord_name)
  where user_id = new.id;
  return new;
end $$;

create trigger on_auth_user_updated after update of raw_user_meta_data on auth.users
  for each row execute function internal.handle_user_update();

/* ---------- Le premier fondateur ---------- */

-- Réservée au tableau de bord de Supabase : aucun visiteur ne peut l'appeler.
create function public.bootstrap_founder(p_discord_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
begin
  if exists (select 1 from public.profiles where role = 'founder') then
    return internal.error_json('founder_exists', '');
  end if;
  select user_id into v_uid from public.private_links where discord_id = p_discord_id;
  if not found then return internal.error_json('user_not_found', ''); end if;
  update public.profiles set role = 'founder', status = 'validated', validated_at = now(), status_reason = null where user_id = v_uid;
  perform internal.log_admin(v_uid, 'founder_bootstrap', v_uid);
  return jsonb_build_object('ok', true);
end $$;

/* ---------- Gestion des rôles ---------- */

-- Fondateur : nomme ou retire les admins et les officiers. Admin : gère les officiers.
create function public.set_member_role(p_user uuid, p_role public.site_role) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_actor_rank integer;
  v_target public.profiles;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    v_actor_rank := internal.current_rank();
    if p_user = v_actor then perform internal.fail('not_on_yourself'); end if;
    select * into v_target from public.profiles where user_id = p_user for update;
    if not found then perform internal.fail('user_not_found'); end if;
    if v_target.status <> 'validated' then perform internal.fail('target_not_validated'); end if;
    if p_role = 'founder' then perform internal.fail('forbidden'); end if;
    if internal.rank_of(v_target.role) >= v_actor_rank or internal.rank_of(p_role) >= v_actor_rank then
      perform internal.fail('forbidden');
    end if;
    update public.profiles set role = p_role where user_id = p_user;
    perform internal.log_admin(v_actor, 'role_changed', p_user, jsonb_build_object('from', v_target.role, 'to', p_role));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.suspend_member(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_target public.profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    if p_user = v_actor then perform internal.fail('not_on_yourself'); end if;
    if v_reason is null or char_length(v_reason) > 300 then perform internal.fail('invalid_reason'); end if;
    select * into v_target from public.profiles where user_id = p_user for update;
    if not found then perform internal.fail('user_not_found'); end if;
    if internal.rank_of(v_target.role) >= internal.current_rank() then perform internal.fail('forbidden'); end if;
    update public.profiles set status = 'suspended', status_reason = v_reason where user_id = p_user;
    -- Un membre suspendu quitte la saison en cours : ses territoires redeviennent libres.
    perform internal.remove_from_active_season(p_user, v_actor, v_reason);
    perform internal.log_admin(v_actor, 'member_suspended', p_user, jsonb_build_object('reason', v_reason));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.reinstate_member(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_target public.profiles;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    select * into v_target from public.profiles where user_id = p_user for update;
    if not found then perform internal.fail('user_not_found'); end if;
    if v_target.status <> 'suspended' then perform internal.fail('target_not_suspended'); end if;
    update public.profiles set status = 'validated', status_reason = null where user_id = p_user;
    perform internal.credit_openfront_ledger(p_user);
    perform internal.log_admin(v_actor, 'member_reinstated', p_user);
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.list_admin_log(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows jsonb;
  v_detail text;
begin
  perform internal.require_rank(3);
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select l.id, l.at, l.action, l.details,
      (select display_name from public.profiles where user_id = l.actor_id) as actor,
      (select display_name from public.profiles where user_id = l.target_id) as target
    from public.admin_log l
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) t;
  return jsonb_build_object('ok', true, 'rows', v_rows);
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

/* ---------- Règles d'accès ---------- */

alter table public.profiles enable row level security;
alter table public.private_links enable row level security;
alter table public.admin_log enable row level security;
alter table public.action_limits enable row level security;
alter table public.action_requests enable row level security;

revoke all on public.profiles, public.private_links, public.admin_log, public.action_limits, public.action_requests from anon, authenticated;
revoke all on sequence public.gaul_numbers from anon, authenticated;

grant select on public.profiles, public.private_links to authenticated;
grant select on public.admin_log to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or internal.current_rank() >= 2);
create policy private_links_read on public.private_links for select to authenticated
  using (user_id = auth.uid() or internal.current_rank() >= 2);
create policy admin_log_read on public.admin_log for select to authenticated
  using (internal.current_rank() >= 3);
