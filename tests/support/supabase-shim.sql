-- Reproduit, pour les tests seulement, ce que Supabase fournit déjà :
-- les rôles, les schémas auth et storage, et les droits par défaut.
-- Ces droits par défaut sont volontairement aussi larges que ceux de Supabase :
-- les tests prouvent ainsi que nos migrations les retirent bien.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}',
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- L'identité donnée par Discord. Contrairement à raw_user_meta_data, un utilisateur ne peut pas la modifier.
create table auth.identities (
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  primary key (provider_id, provider)
);

-- Imite une connexion Discord : Supabase crée le compte, puis l'identité, puis note l'heure de connexion.
-- Le nom du déclencheur le fait passer après ceux de nos migrations. Un compte sans provider_id imite une inscription par e-mail.
create function auth.shim_discord_login() returns trigger language plpgsql as $$
begin
  if new.raw_user_meta_data ? 'provider_id' then
    insert into auth.identities (provider_id, user_id, identity_data, provider)
    values (new.raw_user_meta_data ->> 'provider_id', new.id, new.raw_user_meta_data, 'discord');
  end if;
  update auth.users set last_sign_in_at = now() where id = new.id;
  return new;
end $$;
create trigger zz_shim_discord_login after insert on auth.users
  for each row execute function auth.shim_discord_login();

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'role'
$$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, service_role;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
