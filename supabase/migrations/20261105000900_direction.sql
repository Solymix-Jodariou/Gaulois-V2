-- L'identité Discord, les garde-fous de la suspension, la transmission du fondateur,
-- et l'espace de la direction : annonces, événements, tableau de bord.

/* ---------- L'identité Discord ne vient que de Discord ---------- */

-- raw_user_meta_data s'écrit depuis le navigateur (auth.updateUser, ou une inscription par e-mail) :
-- s'y fier permettrait d'usurper le nom Discord que les officiers vérifient, ou l'identifiant
-- attendu par bootstrap_founder. auth.identities n'est écrite que par Supabase, depuis Discord.
create function internal.sync_discord_identity(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.private_links l
  set discord_id = i.provider_id,
      discord_name = coalesce(i.identity_data ->> 'full_name', i.identity_data ->> 'name', l.discord_name)
  from auth.identities i
  where l.user_id = p_user and i.user_id = p_user and i.provider = 'discord'
$$;

create or replace function internal.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_number integer := nextval('public.gaul_numbers');
begin
  insert into public.profiles (user_id, gaul_number, display_name)
  values (new.id, v_number, 'Gaulois n° ' || v_number);
  -- À cet instant, Supabase n'a pas encore écrit l'identité : elle est lue à la connexion, juste après.
  insert into public.private_links (user_id) values (new.id);
  return new;
end $$;

-- Chaque connexion relit l'identité : c'est aussi ce qui garde le dernier pseudo Discord connu.
create or replace function internal.handle_user_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform internal.sync_discord_identity(new.id);
  return new;
end $$;

drop trigger on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of last_sign_in_at on auth.users
  for each row execute function internal.handle_user_update();

-- Un officier reconnaît la personne sur Discord : un compte sans Discord n'a rien à lui montrer.
create function internal.require_discord_on_request() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.private_links where user_id = new.user_id and discord_id is not null) then
    perform internal.fail('discord_required');
  end if;
  return new;
end $$;

create trigger membership_requires_discord before insert on public.membership_requests
  for each row execute function internal.require_discord_on_request();

/* ---------- La suspension ne se contourne pas ---------- */

-- Posé sur la table : cela couvre toute fonction qui change le statut, présente ou future.
-- La clé de service (auth.uid() vide) reste libre : c'est le tableau de bord de Supabase.
create function internal.guard_status_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'suspended' and new.status <> 'suspended' then
    if auth.uid() is not null and (internal.current_rank() < 3 or internal.rank_of(new.role) >= internal.current_rank()) then
      perform internal.fail('forbidden');
    end if;
    -- Lever la suspension d'un compte jamais validé ne vaut pas validation.
    if new.status = 'validated' and new.validated_at is null then
      new.status := 'pending';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard_status before update of status on public.profiles
  for each row execute function internal.guard_status_change();

-- Une demande restée ouverte ne doit pas survivre à une suspension.
create function internal.close_requests_on_suspension() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'suspended' and old.status <> 'suspended' then
    update public.membership_requests
    set status = 'cancelled', reason = 'Compte suspendu.', decided_at = now()
    where user_id = new.user_id and status = 'pending';
  end if;
  return new;
end $$;

create trigger profiles_close_requests after update of status on public.profiles
  for each row execute function internal.close_requests_on_suspension();

/* ---------- Transmettre le rôle de fondateur ---------- */

create function public.transfer_founder(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_target public.profiles;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(4);
    if p_user = v_actor then perform internal.fail('not_on_yourself'); end if;
    select * into v_target from public.profiles where user_id = p_user for update;
    if not found then perform internal.fail('user_not_found'); end if;
    if v_target.status <> 'validated' then perform internal.fail('target_not_validated'); end if;
    update public.profiles set role = 'admin' where user_id = v_actor;
    update public.profiles set role = 'founder' where user_id = p_user;
    perform internal.log_admin(v_actor, 'founder_transferred', p_user);
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Annonces et événements ---------- */

create table public.site_announcements (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  url text,
  author_id uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_events (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  url text,
  starts_at timestamptz not null,
  author_id uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index site_events_starts_at on public.site_events (starts_at);

-- Ce lien finit dans un href de l'accueil : https seulement, sans espace ni guillemet.
create function internal.check_news_url(p_url text) returns text
language plpgsql immutable as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^[:space:]<>"''`]+$') then
    perform internal.fail('invalid_url');
  end if;
  return v_url;
end $$;

-- Un officier ne touche qu'à ce qu'il a écrit. Un admin touche à tout.
create function internal.require_news_author(p_author uuid, p_actor uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_author is distinct from p_actor and internal.current_rank() < 3 then perform internal.fail('forbidden'); end if;
end $$;

-- Public, même sans compte. L'auteur n'y figure pas : une annonce parle au nom du clan.
create function public.get_site_news() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'announcements', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]') from (
      select id, title, body, url, created_at from public.site_announcements order by created_at desc limit 10
    ) t),
    'events', (select coalesce(jsonb_agg(to_jsonb(t) order by t.starts_at), '[]') from (
      select id, title, description, url, starts_at from public.site_events where starts_at >= now() order by starts_at limit 10
    ) t)
  )
$$;

create function public.save_announcement(p_id bigint, p_title text, p_body text, p_url text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_url text;
  v_row public.site_announcements;
  v_id bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if char_length(v_title) not between 1 and 120 then perform internal.fail('invalid_title'); end if;
    if char_length(v_body) not between 1 and 2000 then perform internal.fail('invalid_body'); end if;
    v_url := internal.check_news_url(p_url);
    if p_id is null then
      insert into public.site_announcements (title, body, url, author_id) values (v_title, v_body, v_url, v_actor) returning id into v_id;
    else
      select * into v_row from public.site_announcements where id = p_id for update;
      if not found then perform internal.fail('news_not_found'); end if;
      perform internal.require_news_author(v_row.author_id, v_actor);
      update public.site_announcements set title = v_title, body = v_body, url = v_url, updated_at = now() where id = p_id;
      v_id := p_id;
    end if;
    perform internal.log_admin(v_actor, 'announcement_saved', null, jsonb_build_object('id', v_id, 'title', v_title));
    return jsonb_build_object('ok', true, 'id', v_id);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.delete_announcement(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.site_announcements;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    select * into v_row from public.site_announcements where id = p_id for update;
    if not found then perform internal.fail('news_not_found'); end if;
    perform internal.require_news_author(v_row.author_id, v_actor);
    delete from public.site_announcements where id = p_id;
    perform internal.log_admin(v_actor, 'announcement_deleted', null, jsonb_build_object('id', p_id, 'title', v_row.title));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.save_event(p_id bigint, p_title text, p_description text, p_url text, p_starts_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_url text;
  v_row public.site_events;
  v_id bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if char_length(v_title) not between 1 and 120 then perform internal.fail('invalid_title'); end if;
    if char_length(coalesce(v_description, '')) > 2000 then perform internal.fail('invalid_body'); end if;
    v_url := internal.check_news_url(p_url);
    if p_starts_at is null or p_starts_at <= now() then perform internal.fail('invalid_start'); end if;
    if p_id is null then
      insert into public.site_events (title, description, url, starts_at, author_id) values (v_title, v_description, v_url, p_starts_at, v_actor) returning id into v_id;
    else
      select * into v_row from public.site_events where id = p_id for update;
      if not found then perform internal.fail('news_not_found'); end if;
      perform internal.require_news_author(v_row.author_id, v_actor);
      update public.site_events set title = v_title, description = v_description, url = v_url, starts_at = p_starts_at, updated_at = now() where id = p_id;
      v_id := p_id;
    end if;
    perform internal.log_admin(v_actor, 'event_saved', null, jsonb_build_object('id', v_id, 'title', v_title, 'starts_at', p_starts_at));
    return jsonb_build_object('ok', true, 'id', v_id);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.delete_event(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_row public.site_events;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    select * into v_row from public.site_events where id = p_id for update;
    if not found then perform internal.fail('news_not_found'); end if;
    perform internal.require_news_author(v_row.author_id, v_actor);
    delete from public.site_events where id = p_id;
    perform internal.log_admin(v_actor, 'event_deleted', null, jsonb_build_object('id', p_id, 'title', v_row.title));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Le tableau de bord ---------- */

create function public.get_direction_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_detail text;
begin
  v_actor := internal.require_rank(2);
  return jsonb_build_object(
    'ok', true,
    'pending_requests', (select count(*) from public.membership_requests where status = 'pending'),
    'pending_donations', (select count(*) from public.donations where status = 'pending'),
    'members', (select count(*) from public.profiles where status = 'validated'),
    'officers', (select count(*) from public.profiles where status = 'validated' and role <> 'member'),
    'suspended', (select count(*) from public.profiles where status = 'suspended'),
    'roster', (select value from public.app_state where key = 'roster'),
    'announcements', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]') from (
      select a.id, a.title, a.body, a.url, a.created_at,
        (select display_name from public.profiles where user_id = a.author_id) as author,
        a.author_id = v_actor or internal.current_rank() >= 3 as editable
      from public.site_announcements a order by a.created_at desc limit 50
    ) t),
    'events', (select coalesce(jsonb_agg(to_jsonb(t) order by t.starts_at), '[]') from (
      select e.id, e.title, e.description, e.url, e.starts_at,
        (select display_name from public.profiles where user_id = e.author_id) as author,
        e.author_id = v_actor or internal.current_rank() >= 3 as editable
      from public.site_events e where e.starts_at >= now() order by e.starts_at limit 50
    ) t)
  );
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

/* ---------- La sauvegarde quotidienne les emporte aussi ---------- */

-- La fonction existante garde toute sa liste : on l'enveloppe plutôt que de la recopier.
alter function public.export_all() rename to export_core;
alter function public.export_core() set schema internal;

create or replace function public.export_all() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select internal.export_core() || jsonb_build_object(
    'site_announcements', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.site_announcements t),
    'site_events', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.site_events t)
  )
$$;

/* ---------- Règles d'accès ---------- */

alter table public.site_announcements enable row level security;
alter table public.site_events enable row level security;
revoke all on public.site_announcements, public.site_events from anon, authenticated;
