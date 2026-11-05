-- Étape 5 : la phase de guerre.

create function internal.resolve_attack(
  p_sent bigint, p_garrison bigint, p_terrain public.terrain_type, c jsonb,
  out won boolean, out ratio float8, out losses float8, out survivors bigint, out garrison_after bigint
) language plpgsql immutable as $$
declare
  v_tiles float8 := (c ->> 'tilesPerTerritory')::float8;
begin
  -- `attackLogic` d'OpenFront, additionné sur les tuiles du territoire. Voir src/lib/conquete/rules.ts.
  ratio := least(
    greatest(p_garrison::float8 / p_sent::float8, (c #>> '{combat,ratioMin}')::float8),
    (c #>> '{combat,ratioMax}')::float8
  );
  losses := internal.terrain_mag(p_terrain, c) * ratio * (
    (c #>> '{combat,lossBase}')::float8 * v_tiles
    + (c #>> '{combat,garrisonBonus}')::float8 * (c #>> '{combat,lossDensity}')::float8 * p_garrison::float8
  );
  won := losses < p_sent::float8;
  if won then
    survivors := greatest(1, floor(p_sent::float8 - losses + 0.5));
    garrison_after := survivors;
  else
    survivors := 0;
    -- La garnison perd la part du territoire que l'attaque aurait prise.
    garrison_after := greatest(1, floor(p_garrison::float8 * (1 - p_sent::float8 / losses) + 0.5));
  end if;
end $$;

create function public.attack(p_request_id uuid, p_territory integer, p_troops bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid;
  v_season public.seasons;
  v_previous jsonb;
  v_player public.players;
  v_territory public.territories;
  v_state public.territory_state;
  v_result record;
  v_now timestamptz;
  v_cooldown timestamptz;
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

    if v_season.status <> 'war' then perform internal.fail('not_war'); end if;
    v_player := internal.require_player(v_season, v_uid);

    select * into v_territory from public.territories where map_version = v_season.map_version and id = p_territory;
    if not found then perform internal.fail('territory_not_found'); end if;
    select * into v_state from public.territory_state where season_id = v_season.id and territory_id = p_territory;
    if not found then perform internal.fail('territory_free'); end if;
    if v_state.owner_id = v_uid then perform internal.fail('own_territory'); end if;
    if not exists (
      select 1 from public.territory_state
      where season_id = v_season.id and owner_id = v_uid and territory_id = any (v_territory.neighbours)
    ) then
      perform internal.fail('not_adjacent');
    end if;

    /* Les garde-fous. */
    if v_state.protected_until is not null and v_state.protected_until > v_now then
      perform internal.fail('territory_protected', jsonb_build_object('until', v_state.protected_until));
    end if;
    if (v_season.config #>> '{limits,lastTerritoryProtected}')::boolean
      and internal.territory_count(v_season.id, v_state.owner_id) = 1 then
      perform internal.fail('last_territory');
    end if;
    v_limit := (v_season.config #>> '{limits,attacksPerDay}')::integer;
    if v_player.attacks_today >= v_limit then
      perform internal.fail('attack_limit', jsonb_build_object('limit', v_limit));
    end if;
    if v_player.last_attack_at is not null then
      v_cooldown := v_player.last_attack_at + make_interval(mins => (v_season.config #>> '{limits,attackCooldownMinutes}')::integer);
      if v_cooldown > v_now then
        perform internal.fail('attack_cooldown', jsonb_build_object('until', v_cooldown));
      end if;
    end if;
    perform internal.require_troops(v_player, p_troops);

    -- Le défenseur régénère jusqu'à cet instant, avant de perdre éventuellement une terre.
    perform internal.touch_player(v_season, v_state.owner_id);

    select * into v_result from internal.resolve_attack(p_troops, v_state.garrison, v_territory.terrain, v_season.config);

    update public.players
    set troops = troops - p_troops, attacks_today = attacks_today + 1, last_attack_at = v_now,
      captured = captured + case when v_result.won then 1 else 0 end
    where season_id = v_season.id and user_id = v_uid
    returning * into v_player;

    if v_result.won then
      update public.territory_state
      set owner_id = v_uid, garrison = v_result.survivors, taken_at = v_now, protected_until = internal.protection_end(v_now, v_season.config)
      where season_id = v_season.id and territory_id = p_territory;
      update public.players set lost = lost + 1 where season_id = v_season.id and user_id = v_state.owner_id;
    else
      update public.territory_state set garrison = v_result.garrison_after
      where season_id = v_season.id and territory_id = p_territory;
    end if;

    insert into public.game_events (season_id, kind, actor_id, target_id, territory_id, sent, losses, garrison_before, garrison_after)
    values (
      v_season.id,
      case when v_result.won then 'attack_won' else 'attack_lost' end,
      v_uid, v_state.owner_id, p_territory, p_troops,
      least(p_troops, floor(v_result.losses + 0.5))::bigint,
      v_state.garrison, v_result.garrison_after
    );

    return internal.remember(p_request_id, v_uid, jsonb_build_object(
      'ok', true,
      'won', v_result.won,
      'territory', p_territory,
      'sent', p_troops,
      'losses', least(p_troops, floor(v_result.losses + 0.5))::bigint,
      'garrison_before', v_state.garrison,
      'garrison_after', v_result.garrison_after,
      'troops', v_player.troops
    ));
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;
