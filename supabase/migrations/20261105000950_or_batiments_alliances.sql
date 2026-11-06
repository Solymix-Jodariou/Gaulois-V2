-- L'or, les bâtiments, les bombes, les alliances et la victoire : les mécaniques d'OpenFront,
-- réécrites pour un jeu par saisons. Voir docs/CONQUETE.md et src/lib/conquete/rules.ts.

/* ---------- Outils ---------- */

create function internal.pair(p_one uuid, p_two uuid, out a uuid, out b uuid)
language sql immutable as $$
  select least(p_one, p_two), greatest(p_one, p_two)
$$;

create function internal.allied(p_season bigint, p_one uuid, p_two uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.alliances
    where season_id = p_season and a = least(p_one, p_two) and b = greatest(p_one, p_two)
      and status = 'active' and expires_at > clock_timestamp()
  )
$$;

-- Ce qui multiplie les pertes de l'attaquant : un poste de défense sur la terre ou chez un voisin
-- du même joueur, et la moitié seulement contre un traître. Le même calcul que `defenceFactor` à l'écran.
create function internal.defence_factor(p_season public.seasons, p_territory public.territories, p_owner uuid) returns float8
language sql stable security definer set search_path = public, pg_temp as $$
  select
    case when exists (
      select 1 from public.territory_state
      where season_id = p_season.id and owner_id = p_owner and building = 'post'
        and (territory_id = p_territory.id or territory_id = any (p_territory.neighbours))
    ) then (p_season.config #>> '{structures,postFactor}')::float8 else 1 end
    * case when exists (
      select 1 from public.players
      where season_id = p_season.id and user_id = p_owner and traitor_until > clock_timestamp()
    ) then (p_season.config #>> '{alliance,traitorFactor}')::float8 else 1 end
$$;

-- Un joueur tient la part de la carte qu'il faut : la saison se termine, il a gagné.
create function internal.check_victory(p_season public.seasons, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if internal.territory_count(p_season.id, p_user)::float8
    / (select count(*) from public.territories where map_version = p_season.map_version)::float8
    >= (p_season.config ->> 'victoryShare')::float8 then
    insert into public.game_events (season_id, kind, actor_id) values (p_season.id, 'victory', p_user);
    perform internal.freeze_season(p_season.id);
  end if;
end $$;

/* ---------- Construire ---------- */

-- Chaque bâtiment du même type coûte le double du précédent, jusqu'à un plafond.
create function internal.building_cost(p_kind text, p_owned integer, c jsonb) returns bigint
language sql immutable as $$
  select floor((c -> 'structures' ->> (p_kind || 'Cost'))::float8
    * power(2, least(p_owned, (c #>> '{structures,maxCostDoublings}')::integer)))::bigint
$$;

create function public.build(p_request_id uuid, p_territory integer, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_previous jsonb;
  v_player public.players;
  v_state public.territory_state;
  v_cost bigint;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    v_previous := internal.replay(p_request_id, v_uid);
    if v_previous is not null then return v_previous; end if;

    v_player := internal.require_player(v_season, v_uid);
    if p_kind is null or p_kind not in ('city', 'port', 'post', 'sam', 'silo') then perform internal.fail('invalid_building'); end if;
    select * into v_state from public.territory_state where season_id = v_season.id and territory_id = p_territory;
    if not found or v_state.owner_id <> v_uid then perform internal.fail('not_your_territory'); end if;
    if v_state.building is not null then perform internal.fail('building_exists'); end if;
    v_cost := internal.building_cost(p_kind, (
      select count(*)::integer from public.territory_state
      where season_id = v_season.id and owner_id = v_uid and building = p_kind
    ), v_season.config);
    if v_player.gold < v_cost then
      perform internal.fail('not_enough_gold', jsonb_build_object('available', v_player.gold, 'cost', v_cost));
    end if;

    update public.players set gold = gold - v_cost where season_id = v_season.id and user_id = v_uid returning * into v_player;
    update public.territory_state set building = p_kind where season_id = v_season.id and territory_id = p_territory;
    insert into public.game_events (season_id, kind, actor_id, territory_id, detail) values (v_season.id, 'building', v_uid, p_territory, p_kind);
    return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'territory', p_territory, 'building', p_kind, 'cost', v_cost, 'gold', v_player.gold));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- La bombe ---------- */

-- Sans hasard : une défense antiaérienne sur la terre visée, ou chez un voisin du même joueur, l'arrête.
create function public.launch_bomb(p_request_id uuid, p_territory integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_previous jsonb;
  v_player public.players;
  v_territory public.territories;
  v_state public.territory_state;
  v_cost bigint;
  v_now timestamptz;
  v_ready timestamptz;
  v_after bigint;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    v_now := clock_timestamp();
    v_previous := internal.replay(p_request_id, v_uid);
    if v_previous is not null then return v_previous; end if;

    if v_season.status <> 'war' then perform internal.fail('not_war'); end if;
    v_player := internal.require_player(v_season, v_uid);
    if not exists (select 1 from public.territory_state where season_id = v_season.id and owner_id = v_uid and building = 'silo') then
      perform internal.fail('no_silo');
    end if;
    select * into v_territory from public.territories where map_version = v_season.map_version and id = p_territory;
    if not found then perform internal.fail('territory_not_found'); end if;
    select * into v_state from public.territory_state where season_id = v_season.id and territory_id = p_territory;
    if not found then perform internal.fail('territory_free'); end if;
    if v_state.owner_id = v_uid then perform internal.fail('own_territory'); end if;
    if internal.allied(v_season.id, v_uid, v_state.owner_id) then perform internal.fail('ally'); end if;
    if v_state.protected_until is not null and v_state.protected_until > v_now then
      perform internal.fail('territory_protected', jsonb_build_object('until', v_state.protected_until));
    end if;
    if v_player.last_bomb_at is not null then
      v_ready := v_player.last_bomb_at + make_interval(hours => (v_season.config #>> '{structures,bombCooldownHours}')::integer);
      if v_ready > v_now then perform internal.fail('bomb_cooldown', jsonb_build_object('until', v_ready)); end if;
    end if;
    v_cost := (v_season.config #>> '{structures,bombCost}')::bigint;
    if v_player.gold < v_cost then
      perform internal.fail('not_enough_gold', jsonb_build_object('available', v_player.gold, 'cost', v_cost));
    end if;

    update public.players set gold = gold - v_cost, last_bomb_at = v_now
    where season_id = v_season.id and user_id = v_uid returning * into v_player;

    if exists (
      select 1 from public.territory_state
      where season_id = v_season.id and owner_id = v_state.owner_id and building = 'sam'
        and (territory_id = p_territory or territory_id = any (v_territory.neighbours))
    ) then
      insert into public.game_events (season_id, kind, actor_id, target_id, territory_id, garrison_before, garrison_after)
      values (v_season.id, 'bomb_intercepted', v_uid, v_state.owner_id, p_territory, v_state.garrison, v_state.garrison);
      return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'intercepted', true, 'garrison_after', v_state.garrison, 'gold', v_player.gold));
    end if;

    -- Le bâtiment est détruit, et la garnison décimée sans jamais disparaître : la terre reste à attaquer.
    v_after := greatest(1, floor(v_state.garrison::float8 * (1 - (v_season.config #>> '{structures,bombDamage}')::float8) + 0.5))::bigint;
    update public.territory_state set garrison = v_after, building = null where season_id = v_season.id and territory_id = p_territory;
    insert into public.game_events (season_id, kind, actor_id, target_id, territory_id, garrison_before, garrison_after, detail)
    values (v_season.id, 'bomb', v_uid, v_state.owner_id, p_territory, v_state.garrison, v_after, v_state.building);
    return internal.remember(p_request_id, v_uid, jsonb_build_object('ok', true, 'intercepted', false, 'garrison_after', v_after, 'gold', v_player.gold));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- Les alliances ---------- */

-- Retrouve un joueur de la saison par son numéro public.
create function internal.season_player_by_number(p_season bigint, p_number integer) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select g.user_id
  from public.players g
  join public.profiles p on p.user_id = g.user_id
  where g.season_id = p_season and p.gaul_number = p_number and g.excluded_at is null
$$;

-- Proposer. Si l'autre avait déjà proposé, l'alliance est conclue.
create function public.propose_alliance(p_number integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_other uuid;
  v_pair record;
  v_row public.alliances;
  v_until timestamptz;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    perform internal.require_player(v_season, v_uid);
    v_other := internal.season_player_by_number(v_season.id, p_number);
    if v_other is null then perform internal.fail('player_not_found'); end if;
    if v_other = v_uid then perform internal.fail('not_on_yourself'); end if;
    select * into v_pair from internal.pair(v_uid, v_other);
    select * into v_row from public.alliances where season_id = v_season.id and a = v_pair.a and b = v_pair.b;
    if found and v_row.expires_at > clock_timestamp() then
      if v_row.status = 'active' then perform internal.fail('already_allied'); end if;
      if v_row.requested_by = v_uid then perform internal.fail('alliance_pending'); end if;
      v_until := clock_timestamp() + make_interval(hours => (v_season.config #>> '{alliance,hours}')::integer);
      update public.alliances set status = 'active', expires_at = v_until where season_id = v_season.id and a = v_pair.a and b = v_pair.b;
      insert into public.game_events (season_id, kind, actor_id, target_id) values (v_season.id, 'alliance_made', v_uid, v_other);
      return jsonb_build_object('ok', true, 'status', 'active', 'expires_at', v_until);
    end if;
    -- Rien, ou une ligne expirée : une nouvelle demande la remplace.
    v_until := clock_timestamp() + make_interval(hours => (v_season.config #>> '{alliance,requestHours}')::integer);
    insert into public.alliances (season_id, a, b, requested_by, status, expires_at)
    values (v_season.id, v_pair.a, v_pair.b, v_uid, 'pending', v_until)
    on conflict (season_id, a, b) do update set requested_by = excluded.requested_by, status = 'pending', expires_at = excluded.expires_at;
    return jsonb_build_object('ok', true, 'status', 'pending', 'expires_at', v_until);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.refuse_alliance(p_number integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_other uuid;
  v_pair record;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    v_other := internal.season_player_by_number(v_season.id, p_number);
    if v_other is null then perform internal.fail('player_not_found'); end if;
    select * into v_pair from internal.pair(v_uid, v_other);
    -- Refuser une demande reçue, ou retirer la sienne.
    delete from public.alliances where season_id = v_season.id and a = v_pair.a and b = v_pair.b and status = 'pending';
    if not found then perform internal.fail('no_alliance_request'); end if;
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

-- Rompre : l'alliance prend fin aussitôt, et tout le monde sait qui a trahi.
create function public.break_alliance(p_number integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_other uuid;
  v_pair record;
  v_until timestamptz;
  v_detail text;
begin
  if internal.game_limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_uid := internal.require_rank(1);
    v_season := internal.begin_game_action();
    perform internal.require_player(v_season, v_uid);
    v_other := internal.season_player_by_number(v_season.id, p_number);
    if v_other is null then perform internal.fail('player_not_found'); end if;
    if not internal.allied(v_season.id, v_uid, v_other) then perform internal.fail('not_allied'); end if;
    select * into v_pair from internal.pair(v_uid, v_other);
    delete from public.alliances where season_id = v_season.id and a = v_pair.a and b = v_pair.b;
    v_until := clock_timestamp() + make_interval(hours => (v_season.config #>> '{alliance,traitorHours}')::integer);
    update public.players set traitor_until = v_until where season_id = v_season.id and user_id = v_uid;
    insert into public.game_events (season_id, kind, actor_id, target_id) values (v_season.id, 'alliance_broken', v_uid, v_other);
    return jsonb_build_object('ok', true, 'traitor_until', v_until);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;
