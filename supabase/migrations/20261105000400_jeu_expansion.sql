-- Étape 4 : le jeu, sa carte et la phase d'expansion.
--
-- Toutes les actions sont calculées ici. Le navigateur demande, le serveur décide.
-- Un verrou par saison ne laisse passer qu'une action à la fois : deux attaques simultanées
-- s'exécutent l'une après l'autre, sans doublon ni troupes négatives.

create type public.season_status as enum ('draft', 'expansion', 'war', 'closed');
create type public.terrain_type as enum ('plains', 'highland', 'mountain');

create table public.seasons (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 60),
  status public.season_status not null default 'draft',
  map_version text not null,
  config jsonb not null,
  war_starts_at timestamptz,
  started_at timestamptz,
  war_started_at timestamptz,
  closed_at timestamptz,
  final_standings jsonb,
  final_map jsonb,
  final_donors jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- Une seule saison ouverte à la fois, brouillon compris.
create unique index seasons_one_open on public.seasons ((true)) where status in ('draft', 'expansion', 'war');

create table public.territories (
  map_version text not null,
  id integer not null,
  name text not null,
  terrain public.terrain_type not null,
  neighbours integer[] not null,
  primary key (map_version, id)
);

-- Une ligne par territoire occupé : un territoire sans ligne est libre.
create table public.territory_state (
  season_id bigint not null references public.seasons (id) on delete cascade,
  territory_id integer not null,
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  garrison bigint not null check (garrison >= 1),
  taken_at timestamptz not null,
  protected_until timestamptz,
  -- Un seul bâtiment par terre. Il change de main avec elle.
  building text check (building in ('city', 'port', 'post', 'sam', 'silo')),
  primary key (season_id, territory_id)
);
create index territory_state_by_owner on public.territory_state (season_id, owner_id);

create table public.players (
  season_id bigint not null references public.seasons (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  troops bigint not null check (troops >= 0),
  troops_at timestamptz not null,
  counters_day date not null,
  expansions_today integer not null default 0 check (expansions_today >= 0),
  attacks_today integer not null default 0 check (attacks_today >= 0),
  last_attack_at timestamptz,
  captured integer not null default 0,
  lost integer not null default 0,
  gold bigint not null default 0 check (gold >= 0),
  gold_at timestamptz not null default now(),
  -- Pendant ce temps, attaquer ce joueur coûte moitié moins : il a rompu une alliance.
  traitor_until timestamptz,
  last_bomb_at timestamptz,
  excluded_at timestamptz,
  excluded_reason text,
  joined_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

-- Une ligne par paire de joueurs, le plus petit identifiant dans `a`.
create table public.alliances (
  season_id bigint not null references public.seasons (id) on delete cascade,
  a uuid not null references public.profiles (user_id) on delete cascade,
  b uuid not null references public.profiles (user_id) on delete cascade,
  requested_by uuid not null references public.profiles (user_id) on delete cascade,
  status text not null check (status in ('pending', 'active')),
  expires_at timestamptz not null,
  primary key (season_id, a, b),
  check (a < b)
);

create table public.game_events (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('season_started', 'war_started', 'season_closed', 'start', 'expand', 'attack_won', 'attack_lost', 'player_excluded', 'donation', 'donation_cancelled', 'building', 'bomb', 'bomb_intercepted', 'alliance_made', 'alliance_broken', 'victory')),
  actor_id uuid references public.profiles (user_id) on delete set null,
  target_id uuid references public.profiles (user_id) on delete set null,
  territory_id integer,
  sent bigint,
  losses bigint,
  garrison_before bigint,
  garrison_after bigint,
  -- Pour un don : les capsules données. Les troupes reçues sont dans `sent`.
  capsules bigint,
  -- Pour un bâtiment : son type.
  detail text,
  notified_at timestamptz
);
create index game_events_feed on public.game_events (season_id, id desc);
create index game_events_to_notify on public.game_events (id) where notified_at is null;

/* ---------- Les réglages : vérifiés avant d'être acceptés ---------- */

-- Renvoie le nom du premier réglage invalide, ou null si tout est correct.
create function internal.config_problem(c jsonb) returns text
language plpgsql immutable as $$
declare
  v_item record;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return 'config'; end if;
  for v_item in
    select * from (values
      ('{tilesPerTerritory}', 1::float8, 100000::float8),
      ('{capacity,multiplier}', 0.1, 100),
      ('{capacity,tilesExponent}', 0.01, 2),
      ('{capacity,tilesFactor}', 0, 10000000),
      ('{capacity,base}', 1, 1000000000),
      ('{capacity,capsuleFactor}', 0, 10000000),
      ('{capacity,capsuleExponent}', 0.01, 1),
      ('{regen,base}', 0, 1000000),
      ('{regen,exponent}', 0.01, 1.5),
      ('{regen,divisor}', 0.01, 10000),
      ('{regen,tickMinutes}', 1, 1440),
      ('{startShare}', 0, 1),
      ('{troopsPerCapsule}', 0, 100000),
      ('{terrain,plains}', 1, 10000),
      ('{terrain,highland}', 1, 10000),
      ('{terrain,mountain}', 1, 10000),
      ('{neutralDivisor}', 0.1, 1000),
      ('{combat,ratioMin}', 0.01, 100),
      ('{combat,ratioMax}', 0.01, 100),
      ('{combat,lossBase}', 0, 100),
      ('{combat,lossDensity}', 0, 10),
      ('{combat,garrisonBonus}', 0, 100),
      ('{limits,expansionsPerDay}', 1, 1000),
      ('{limits,attacksPerDay}', 1, 1000),
      ('{limits,attackCooldownMinutes}', 0, 10080),
      ('{limits,protectionHours}', 0, 720),
      ('{limits,actionsPerMinute}', 1, 600),
      ('{victoryShare}', 0.01, 1),
      ('{gold,start}', 0, 1000000000),
      ('{gold,perTerritoryPerHour}', 0, 1000000),
      ('{structures,cityCost}', 0, 1000000000),
      ('{structures,portCost}', 0, 1000000000),
      ('{structures,postCost}', 0, 1000000000),
      ('{structures,samCost}', 0, 1000000000),
      ('{structures,siloCost}', 0, 1000000000),
      ('{structures,bombCost}', 0, 1000000000),
      ('{structures,maxCostDoublings}', 0, 20),
      ('{structures,cityCapacity}', 0, 1000000000),
      ('{structures,postFactor}', 1, 100),
      ('{structures,portGoldPerHour}', 0, 1000000),
      ('{structures,tradeGoldPerPort}', 0, 1000000),
      ('{structures,bombDamage}', 0, 1),
      ('{structures,bombCooldownHours}', 0, 720),
      ('{alliance,hours}', 1, 720),
      ('{alliance,requestHours}', 1, 720),
      ('{alliance,traitorHours}', 0, 720),
      ('{alliance,traitorFactor}', 0.01, 1)
    ) as v (path, low, high)
  loop
    if jsonb_typeof(c #> v_item.path::text[]) is distinct from 'number'
      or (c #>> v_item.path::text[])::float8 not between v_item.low and v_item.high then
      return v_item.path;
    end if;
  end loop;
  -- Ces réglages comptent des actions ou des durées entières : 1,5 attaque n'a pas de sens.
  for v_item in
    select * from (values
      ('{regen,tickMinutes}'), ('{limits,expansionsPerDay}'), ('{limits,attacksPerDay}'),
      ('{limits,attackCooldownMinutes}'), ('{limits,protectionHours}'), ('{limits,actionsPerMinute}'),
      ('{structures,maxCostDoublings}'), ('{structures,bombCooldownHours}'), ('{alliance,hours}'), ('{alliance,requestHours}'), ('{alliance,traitorHours}')
    ) as v (path)
  loop
    if (c #>> v_item.path::text[])::float8 <> floor((c #>> v_item.path::text[])::float8) then
      return v_item.path;
    end if;
  end loop;
  if jsonb_typeof(c #> '{limits,lastTerritoryProtected}') is distinct from 'boolean' then
    return '{limits,lastTerritoryProtected}';
  end if;
  if (c #>> '{combat,ratioMin}')::float8 > (c #>> '{combat,ratioMax}')::float8 then
    return '{combat,ratioMin}';
  end if;
  return null;
end $$;

/* ---------- Les formules, adaptées d'OpenFront : voir src/lib/conquete/rules.ts ---------- */

create function internal.capacity(p_territories integer, p_capsules bigint, c jsonb) returns float8
language sql immutable as $$
  select (c #>> '{capacity,multiplier}')::float8 * (
      power(p_territories::float8 * (c ->> 'tilesPerTerritory')::float8, (c #>> '{capacity,tilesExponent}')::float8)
        * (c #>> '{capacity,tilesFactor}')::float8
      + (c #>> '{capacity,base}')::float8
    )
    + (c #>> '{capacity,capsuleFactor}')::float8
      * power(greatest(p_capsules, 0)::float8, (c #>> '{capacity,capsuleExponent}')::float8)
$$;

create function internal.regen_step(p_troops float8, p_capacity float8, c jsonb) returns float8
language sql immutable as $$
  select ((c #>> '{regen,base}')::float8 + power(greatest(p_troops, 0), (c #>> '{regen,exponent}')::float8) / (c #>> '{regen,divisor}')::float8)
    * (1 - p_troops / p_capacity)
$$;

-- La réserve se calcule à la demande, un pas par tranche de temps écoulée : aucune tâche planifiée.
create function internal.settled(
  p_troops bigint, p_since timestamptz, p_now timestamptz, p_capacity float8, c jsonb,
  out troops bigint, out since timestamptz
) language plpgsql immutable as $$
declare
  v_tick float8 := (c #>> '{regen,tickMinutes}')::float8 * 60;
  v_steps bigint := floor(extract(epoch from p_now - p_since) / v_tick);
  v_value float8 := p_troops;
begin
  if v_steps <= 0 then
    troops := p_troops;
    since := p_since;
    return;
  end if;
  for i in 1 .. least(v_steps, 5000) loop
    v_value := greatest(0, v_value + internal.regen_step(v_value, p_capacity, c));
  end loop;
  troops := floor(v_value);
  since := p_since + make_interval(secs => v_steps * v_tick);
end $$;

create function internal.terrain_mag(p_terrain public.terrain_type, c jsonb) returns float8
language sql immutable as $$
  select (c -> 'terrain' ->> p_terrain::text)::float8
$$;

create function internal.start_troops(p_capsules bigint, c jsonb) returns bigint
language sql immutable as $$
  select floor((c ->> 'startShare')::float8 * internal.capacity(0, p_capsules, c) + 0.5)::bigint
$$;

create function internal.neutral_cost(p_terrain public.terrain_type, c jsonb) returns bigint
language sql immutable as $$
  select ceil(internal.terrain_mag(p_terrain, c) / (c ->> 'neutralDivisor')::float8 * (c ->> 'tilesPerTerritory')::float8)::bigint
$$;

/* ---------- Outils des actions ---------- */

create function internal.paris_today() returns date
language sql stable as $$
  select (clock_timestamp() at time zone 'Europe/Paris')::date
$$;

create function internal.game_limit_exceeded() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit integer;
begin
  select (config #>> '{limits,actionsPerMinute}')::integer into v_limit
  from public.seasons where status in ('expansion', 'war') limit 1;
  return internal.limit_exceeded(coalesce(v_limit, 30));
end $$;

create function internal.start_war(p_season bigint, p_at timestamptz) returns public.seasons
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_season public.seasons;
begin
  update public.seasons set status = 'war', war_started_at = p_at where id = p_season returning * into v_season;
  insert into public.game_events (season_id, at, kind) values (p_season, p_at, 'war_started');
  return v_season;
end $$;

-- Ouvre une action de jeu : prend le verrou de la saison, puis la relit.
create function internal.begin_game_action() returns public.seasons
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
  v_season public.seasons;
begin
  select id into v_id from public.seasons where status in ('expansion', 'war') limit 1;
  if not found then perform internal.fail('no_active_season'); end if;
  perform pg_advisory_xact_lock(727001, v_id::integer);
  select * into v_season from public.seasons where id = v_id;
  if v_season.status not in ('expansion', 'war') then perform internal.fail('no_active_season'); end if;
  -- La date fixée par un admin est atteinte : la guerre commence à la première action qui suit.
  if v_season.status = 'expansion' and v_season.war_starts_at is not null and v_season.war_starts_at <= clock_timestamp() then
    v_season := internal.start_war(v_season.id, v_season.war_starts_at);
  end if;
  return v_season;
end $$;

-- La carte est pleine : la guerre commence aussitôt.
create function internal.war_if_full(p_season public.seasons) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_season.status = 'expansion'
    and (select count(*) from public.territory_state where season_id = p_season.id)
      >= (select count(*) from public.territories where map_version = p_season.map_version) then
    perform internal.start_war(p_season.id, clock_timestamp());
  end if;
end $$;

create function internal.territory_count(p_season bigint, p_user uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from public.territory_state where season_id = p_season and owner_id = p_user
$$;

-- La capacité apportée par les villes d'un joueur, en plus de celle de ses terres et de ses capsules.
create function internal.city_capacity(p_season public.seasons, p_user uuid) returns float8
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::float8 * (p_season.config #>> '{structures,cityCapacity}')::float8
  from public.territory_state
  where season_id = p_season.id and owner_id = p_user and building = 'city'
$$;

-- L'or gagné par heure : chaque terre rapporte, et chaque port commerce avec ceux des autres joueurs.
create function internal.gold_rate(p_season public.seasons, p_user uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select (
    count(*) filter (where owner_id = p_user) * (p_season.config #>> '{gold,perTerritoryPerHour}')::float8
    + count(*) filter (where owner_id = p_user and building = 'port') * (
        (p_season.config #>> '{structures,portGoldPerHour}')::float8
        + (p_season.config #>> '{structures,tradeGoldPerPort}')::float8 * least(count(*) filter (where owner_id <> p_user and building = 'port'), 10)
      )
  )::bigint
  from public.territory_state
  where season_id = p_season.id
$$;

-- Met la réserve et les compteurs du jour d'un joueur à l'heure. Appelée sous le verrou de la saison.
create function internal.touch_player(p_season public.seasons, p_user uuid) returns public.players
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_player public.players;
  v_capsules bigint;
  v_cap float8;
  v_now timestamptz := clock_timestamp();
  v_today date := internal.paris_today();
  v_settled record;
  v_hours integer;
begin
  select * into v_player from public.players where season_id = p_season.id and user_id = p_user;
  if not found then return null; end if;
  select capsules_total into v_capsules from public.profiles where user_id = p_user;
  v_cap := internal.capacity(internal.territory_count(p_season.id, p_user), v_capsules, p_season.config) + internal.city_capacity(p_season, p_user);
  select * into v_settled from internal.settled(v_player.troops, v_player.troops_at, v_now, v_cap, p_season.config);
  v_hours := floor(extract(epoch from v_now - v_player.gold_at) / 3600);
  update public.players
  set troops = v_settled.troops,
    troops_at = v_settled.since,
    gold = gold + v_hours * internal.gold_rate(p_season, p_user),
    gold_at = gold_at + make_interval(hours => v_hours),
    counters_day = v_today,
    expansions_today = case when counters_day = v_today then expansions_today else 0 end,
    attacks_today = case when counters_day = v_today then attacks_today else 0 end
  where season_id = p_season.id and user_id = p_user
  returning * into v_player;
  return v_player;
end $$;

-- Le joueur et ses droits pour cette action.
create function internal.require_player(p_season public.seasons, p_user uuid) returns public.players
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_player public.players;
begin
  v_player := internal.touch_player(p_season, p_user);
  if v_player.user_id is null or internal.territory_count(p_season.id, p_user) = 0 then
    if v_player.excluded_at is not null then perform internal.fail('excluded'); end if;
    perform internal.fail('no_start');
  end if;
  if v_player.excluded_at is not null then perform internal.fail('excluded'); end if;
  return v_player;
end $$;

create function internal.require_troops(p_player public.players, p_troops bigint) returns void
language plpgsql immutable as $$
begin
  if p_troops is null or p_troops < 1 then perform internal.fail('invalid_troops'); end if;
  if p_troops > p_player.troops then
    perform internal.fail('not_enough_troops', jsonb_build_object('available', p_player.troops));
  end if;
end $$;

create function internal.protection_end(p_at timestamptz, c jsonb) returns timestamptz
language sql immutable as $$
  select p_at + make_interval(hours => (c #>> '{limits,protectionHours}')::integer)
$$;

/* ---------- Phase 1 : choisir son territoire de départ ---------- */

create function public.choose_start(p_request_id uuid, p_territory integer, p_garrison bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_previous jsonb;
  v_player public.players;
  v_capsules bigint;
  v_now timestamptz;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    v_now := clock_timestamp();
    v_previous := internal.replay(p_request_id, v_uid);
    if v_previous is not null then return v_previous; end if;

    if not exists (select 1 from public.territories where map_version = v_season.map_version and id = p_territory) then
      perform internal.fail('territory_not_found');
    end if;
    v_player := internal.touch_player(v_season, v_uid);
    if v_player.user_id is not null then
      if v_player.excluded_at is not null then perform internal.fail('excluded'); end if;
      if internal.territory_count(v_season.id, v_uid) > 0 then perform internal.fail('already_started'); end if;
    end if;
    if exists (select 1 from public.territory_state where season_id = v_season.id and territory_id = p_territory) then
      perform internal.fail('territory_taken');
    end if;
    if v_player.user_id is null then
      select capsules_total into v_capsules from public.profiles where user_id = v_uid;
      insert into public.players (season_id, user_id, gold, gold_at, troops, troops_at, counters_day)
      values (
        v_season.id, v_uid, (v_season.config #>> '{gold,start}')::bigint, v_now,
        -- Les dons faits depuis le lancement de la saison l'attendaient.
        internal.start_reserve(v_uid, v_capsules, v_season),
        v_now, internal.paris_today()
      )
      returning * into v_player;
    end if;
    perform internal.require_troops(v_player, p_garrison);

    update public.players set troops = troops - p_garrison where season_id = v_season.id and user_id = v_uid returning * into v_player;
    insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at, protected_until)
    values (v_season.id, p_territory, v_uid, p_garrison, v_now, internal.protection_end(v_now, v_season.config));
    insert into public.game_events (season_id, kind, actor_id, territory_id, sent, garrison_after)
    values (v_season.id, 'start', v_uid, p_territory, p_garrison, p_garrison);
    perform internal.war_if_full(v_season);
    return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'territory', p_territory, 'garrison', p_garrison, 'troops', v_player.troops));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Phase 1 : conquérir une terre libre voisine ---------- */

create function public.expand(p_request_id uuid, p_territory integer, p_troops bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_previous jsonb;
  v_player public.players;
  v_territory public.territories;
  v_cost bigint;
  v_garrison bigint;
  v_now timestamptz;
  v_limit integer;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    v_now := clock_timestamp();
    v_previous := internal.replay(p_request_id, v_uid);
    if v_previous is not null then return v_previous; end if;

    v_player := internal.require_player(v_season, v_uid);
    select * into v_territory from public.territories where map_version = v_season.map_version and id = p_territory;
    if not found then perform internal.fail('territory_not_found'); end if;
    if exists (select 1 from public.territory_state where season_id = v_season.id and territory_id = p_territory) then
      perform internal.fail('territory_taken');
    end if;
    if not exists (
      select 1 from public.territory_state
      where season_id = v_season.id and owner_id = v_uid and territory_id = any (v_territory.neighbours)
    ) then
      perform internal.fail('not_adjacent');
    end if;
    v_limit := (v_season.config #>> '{limits,expansionsPerDay}')::integer;
    if v_player.expansions_today >= v_limit then
      perform internal.fail('expansion_limit', jsonb_build_object('limit', v_limit));
    end if;
    perform internal.require_troops(v_player, p_troops);
    v_cost := internal.neutral_cost(v_territory.terrain, v_season.config);
    v_garrison := p_troops - v_cost;
    if v_garrison < 1 then
      perform internal.fail('too_few_troops', jsonb_build_object('minimum', v_cost + 1));
    end if;

    update public.players set troops = troops - p_troops, expansions_today = expansions_today + 1
    where season_id = v_season.id and user_id = v_uid returning * into v_player;
    insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at, protected_until)
    values (v_season.id, p_territory, v_uid, v_garrison, v_now, internal.protection_end(v_now, v_season.config));
    insert into public.game_events (season_id, kind, actor_id, territory_id, sent, losses, garrison_after)
    values (v_season.id, 'expand', v_uid, p_territory, p_troops, v_cost, v_garrison);
    perform internal.war_if_full(v_season);
    perform internal.check_victory(v_season, v_uid);
    return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'territory', p_territory, 'cost', v_cost, 'garrison', v_garrison, 'troops', v_player.troops));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Renforcer un de ses territoires ---------- */

create function public.reinforce(p_request_id uuid, p_territory integer, p_troops bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_previous jsonb;
  v_player public.players;
  v_garrison bigint;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    v_previous := internal.replay(p_request_id, v_uid);
    if v_previous is not null then return v_previous; end if;

    v_player := internal.require_player(v_season, v_uid);
    if not exists (select 1 from public.territory_state where season_id = v_season.id and territory_id = p_territory and owner_id = v_uid) then
      perform internal.fail('not_your_territory');
    end if;
    perform internal.require_troops(v_player, p_troops);
    update public.players set troops = troops - p_troops where season_id = v_season.id and user_id = v_uid returning * into v_player;
    update public.territory_state set garrison = garrison + p_troops
    where season_id = v_season.id and territory_id = p_territory returning garrison into v_garrison;
    return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'territory', p_territory, 'garrison', v_garrison, 'troops', v_player.troops));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Ce que tout le monde voit ---------- */

create function public.get_game_state() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_season public.seasons;
  v_players jsonb;
  v_territories jsonb;
  v_alliances jsonb;
  v_uid uuid := auth.uid();
  v_me integer;
begin
  select * into v_season from public.seasons where status in ('expansion', 'war') order by id desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'season', null, 'read_at', now());
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.territories desc, t.number), '[]') into v_players from (
    select p.gaul_number as number, p.display_name as name, g.captured, g.lost,
      case when g.traitor_until > now() then g.traitor_until end as traitor_until,
      (select count(*) from public.territory_state s where s.season_id = g.season_id and s.owner_id = g.user_id) as territories
    from public.players g
    join public.profiles p on p.user_id = g.user_id
    where g.season_id = v_season.id and g.excluded_at is null
  ) t;

  select coalesce(jsonb_agg(row_to_json(t) order by t.id), '[]') into v_territories from (
    select s.territory_id as id, p.gaul_number as owner, s.garrison, s.protected_until, s.building, s.taken_at
    from public.territory_state s
    join public.profiles p on p.user_id = s.owner_id
    where s.season_id = v_season.id
  ) t;

  -- Les alliances se voient : c'est toute leur force, et ce qui rend la trahison publique.
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_alliances from (
    select pa.gaul_number as a, pb.gaul_number as b, l.expires_at
    from public.alliances l
    join public.profiles pa on pa.user_id = l.a
    join public.profiles pb on pb.user_id = l.b
    where l.season_id = v_season.id and l.status = 'active' and l.expires_at > now()
  ) t;

  select gaul_number into v_me from public.profiles where user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'season', jsonb_build_object(
      'id', v_season.id,
      'name', v_season.name,
      'map_version', v_season.map_version,
      -- La date atteinte vaut déjà pour l'affichage, avant même la première action qui la constate.
      'phase', case when v_season.status = 'expansion' and v_season.war_starts_at <= now() then 'war' else v_season.status::text end,
      'started_at', v_season.started_at,
      'war_starts_at', v_season.war_starts_at,
      'war_started_at', v_season.war_started_at,
      'config', v_season.config
    ),
    'players', v_players,
    'territories', v_territories,
    'alliances', v_alliances,
    'me', v_me,
    'read_at', now()
  );
end $$;

create function public.get_feed(p_season bigint default null, p_before bigint default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_season public.seasons;
  v_rows jsonb;
begin
  if p_season is null then
    select * into v_season from public.seasons where status in ('expansion', 'war', 'closed') order by id desc limit 1;
  else
    select * into v_season from public.seasons where id = p_season and status <> 'draft';
  end if;
  if not found then return jsonb_build_object('ok', true, 'rows', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select e.id, e.at, e.kind, e.sent, e.losses, e.garrison_before, e.garrison_after, e.capsules, e.detail,
      -- Un donneur anonyme le reste aussi dans le fil.
      case when e.kind in ('donation', 'donation_cancelled') and a.anonymous_donations then null else a.display_name end as actor,
      d.display_name as target, t.name as territory, t.id as territory_id
    from public.game_events e
    left join public.profiles a on a.user_id = e.actor_id
    left join public.profiles d on d.user_id = e.target_id
    left join public.territories t on t.map_version = v_season.map_version and t.id = e.territory_id
    where e.season_id = v_season.id and (p_before is null or e.id < p_before)
    order by e.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) t;
  return jsonb_build_object('ok', true, 'season', v_season.id, 'rows', v_rows);
end $$;

/* ---------- Ce que voit le joueur connecté ---------- */

create function public.get_my_game() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_player public.players;
  v_capsules bigint;
  v_count integer;
  v_cap float8;
  v_settled record;
  v_today date := internal.paris_today();
  v_tick float8;
  v_gold_rate bigint;
  v_hours integer;
  v_detail text;
begin
  v_uid := internal.require_rank(1);
  select capsules_total into v_capsules from public.profiles where user_id = v_uid;
  select * into v_season from public.seasons where status in ('expansion', 'war') order by id desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'season', null, 'capsules', v_capsules); end if;

  select * into v_player from public.players where season_id = v_season.id and user_id = v_uid;
  if not found then
    return jsonb_build_object(
      'ok', true,
      'season', v_season.id,
      'capsules', v_capsules,
      'in_game', false,
      'start_troops', internal.start_reserve(v_uid, v_capsules, v_season)
    );
  end if;

  v_count := internal.territory_count(v_season.id, v_uid);
  v_cap := internal.capacity(v_count, v_capsules, v_season.config) + internal.city_capacity(v_season, v_uid);
  v_gold_rate := internal.gold_rate(v_season, v_uid);
  v_hours := floor(extract(epoch from now() - v_player.gold_at) / 3600);
  select * into v_settled from internal.settled(v_player.troops, v_player.troops_at, now(), v_cap, v_season.config);
  v_tick := (v_season.config #>> '{regen,tickMinutes}')::float8 * 60;

  return jsonb_build_object(
    'ok', true,
    'season', v_season.id,
    'capsules', v_capsules,
    'in_game', true,
    'excluded', v_player.excluded_at is not null,
    'excluded_reason', v_player.excluded_reason,
    'troops', v_settled.troops,
    'capacity', floor(v_cap),
    'territories', v_count,
    'next_regen', floor(internal.regen_step(v_settled.troops, v_cap, v_season.config)),
    'next_regen_at', v_settled.since + make_interval(secs => v_tick),
    'expansions_today', case when v_player.counters_day = v_today then v_player.expansions_today else 0 end,
    'attacks_today', case when v_player.counters_day = v_today then v_player.attacks_today else 0 end,
    'cooldown_until', case when v_player.last_attack_at is null then null
      else v_player.last_attack_at + make_interval(mins => (v_season.config #>> '{limits,attackCooldownMinutes}')::integer) end,
    'captured', v_player.captured,
    'lost', v_player.lost,
    'gold', v_player.gold + v_hours * v_gold_rate,
    'gold_per_hour', v_gold_rate,
    'traitor_until', case when v_player.traitor_until > now() then v_player.traitor_until end,
    'bomb_ready_at', case when v_player.last_bomb_at is null then null
      else v_player.last_bomb_at + make_interval(hours => (v_season.config #>> '{structures,bombCooldownHours}')::integer) end,
    -- Les joueurs qui attendent ma réponse, et ceux à qui j'ai proposé.
    'alliance_requests', (select coalesce(jsonb_agg(jsonb_build_object('number', p.gaul_number, 'name', p.display_name)), '[]')
      from public.alliances l join public.profiles p on p.user_id = l.requested_by
      where l.season_id = v_season.id and l.status = 'pending' and l.expires_at > now() and l.requested_by <> v_uid and v_uid in (l.a, l.b)),
    'alliance_sent', (select coalesce(jsonb_agg(p.gaul_number), '[]')
      from public.alliances l join public.profiles p on p.user_id = case when l.a = v_uid then l.b else l.a end
      where l.season_id = v_season.id and l.status = 'pending' and l.expires_at > now() and l.requested_by = v_uid)
  );
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

/* ---------- Règles d'accès ---------- */

alter table public.seasons enable row level security;
alter table public.territories enable row level security;
alter table public.territory_state enable row level security;
alter table public.players enable row level security;
alter table public.game_events enable row level security;
alter table public.alliances enable row level security;

revoke all on public.seasons, public.territories, public.territory_state, public.players, public.game_events, public.alliances from anon, authenticated;

-- Le public lit tout par des fonctions, qui ne montrent jamais l'identifiant d'un compte.
-- Un membre connecté peut aussi lire ses propres lignes.
grant select on public.players, public.territories to authenticated;
create policy players_read on public.players for select to authenticated
  using (user_id = auth.uid() or internal.current_rank() >= 2);
create policy territories_read on public.territories for select to authenticated using (true);
