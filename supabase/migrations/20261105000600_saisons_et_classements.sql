-- Étape 6 : les saisons, la modération, l'historique et les exports.

/* ---------- Lancer et régler une saison : admins ---------- */

create function public.create_season(p_name text, p_config jsonb, p_map_version text default 'v1') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_problem text;
  v_id bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    if char_length(v_name) not between 1 and 60 then perform internal.fail('invalid_name'); end if;
    v_problem := internal.config_problem(p_config);
    if v_problem is not null then perform internal.fail('invalid_config', jsonb_build_object('field', v_problem)); end if;
    if not exists (select 1 from public.territories where map_version = p_map_version) then
      perform internal.fail('map_not_found');
    end if;
    if exists (select 1 from public.seasons where status in ('draft', 'expansion', 'war')) then
      perform internal.fail('season_open');
    end if;
    insert into public.seasons (name, map_version, config, created_by)
    values (v_name, p_map_version, p_config, v_actor)
    returning id into v_id;
    perform internal.log_admin(v_actor, 'season_created', null, jsonb_build_object('season', v_id, 'name', v_name));
    return jsonb_build_object('ok', true, 'id', v_id);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.update_season_config(p_season bigint, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_season public.seasons;
  v_problem text;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    v_problem := internal.config_problem(p_config);
    if v_problem is not null then perform internal.fail('invalid_config', jsonb_build_object('field', v_problem)); end if;
    perform pg_advisory_xact_lock(727001, p_season::integer);
    select * into v_season from public.seasons where id = p_season;
    if not found then perform internal.fail('season_not_found'); end if;
    if v_season.status = 'closed' then perform internal.fail('season_closed'); end if;
    update public.seasons set config = p_config where id = p_season;
    perform internal.log_admin(v_actor, 'season_config_changed', null, jsonb_build_object('season', p_season, 'before', v_season.config, 'after', p_config));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.start_season(p_season bigint, p_war_starts_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_season public.seasons;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    perform pg_advisory_xact_lock(727001, p_season::integer);
    select * into v_season from public.seasons where id = p_season;
    if not found then perform internal.fail('season_not_found'); end if;
    if v_season.status <> 'draft' then perform internal.fail('season_not_draft'); end if;
    if p_war_starts_at is not null and p_war_starts_at <= now() then perform internal.fail('invalid_date'); end if;
    update public.seasons set status = 'expansion', started_at = now(), war_starts_at = p_war_starts_at where id = p_season;
    insert into public.game_events (season_id, kind) values (p_season, 'season_started');
    perform internal.log_admin(v_actor, 'season_started', null, jsonb_build_object('season', p_season, 'war_starts_at', p_war_starts_at));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

-- Fixe la date de la guerre. Une date passée ou présente la déclenche tout de suite.
create function public.set_war_date(p_season bigint, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_season public.seasons;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    perform pg_advisory_xact_lock(727001, p_season::integer);
    select * into v_season from public.seasons where id = p_season;
    if not found then perform internal.fail('season_not_found'); end if;
    if v_season.status <> 'expansion' then perform internal.fail('not_expansion'); end if;
    if p_at is null then perform internal.fail('invalid_date'); end if;
    update public.seasons set war_starts_at = p_at where id = p_season;
    if p_at <= clock_timestamp() then
      perform internal.start_war(p_season, clock_timestamp());
    end if;
    perform internal.log_admin(v_actor, 'war_date_set', null, jsonb_build_object('season', p_season, 'at', p_at));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function internal.standings(p_season bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.rank_territories, t.rank_conquerors, t.number), '[]') from (
    select x.*,
      rank() over (order by x.territories desc)::integer as rank_territories,
      rank() over (order by x.captured desc)::integer as rank_conquerors
    from (
      select p.gaul_number as number, p.display_name as name, g.captured, g.lost,
        (select count(*)::integer from public.territory_state s where s.season_id = g.season_id and s.owner_id = g.user_id) as territories
      from public.players g
      join public.profiles p on p.user_id = g.user_id
      where g.season_id = p_season and g.excluded_at is null
    ) x
  ) t
$$;

-- Clôture : le classement et la carte sont figés, tels quels, pour toujours.
create function public.close_season(p_season bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_season public.seasons;
  v_map jsonb;
  v_donors jsonb;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(3);
    perform pg_advisory_xact_lock(727001, p_season::integer);
    select * into v_season from public.seasons where id = p_season;
    if not found then perform internal.fail('season_not_found'); end if;
    if v_season.status not in ('expansion', 'war') then perform internal.fail('season_not_running'); end if;

    select coalesce(jsonb_agg(row_to_json(t) order by t.id), '[]') into v_map from (
      select s.territory_id as id, p.gaul_number as owner, s.garrison
      from public.territory_state s
      join public.profiles p on p.user_id = s.owner_id
      where s.season_id = p_season
    ) t;
    select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_donors from (
      select rank() over (order by p.capsules_total desc)::integer as rank,
        case when p.anonymous_donations then null else p.display_name end as name,
        p.capsules_total as total
      from public.profiles p
      where p.status = 'validated' and p.capsules_total > 0
      order by p.capsules_total desc, p.gaul_number
      limit 20
    ) t;

    update public.seasons
    set status = 'closed', closed_at = now(), final_standings = internal.standings(p_season), final_map = v_map, final_donors = v_donors
    where id = p_season;
    insert into public.game_events (season_id, kind) values (p_season, 'season_closed');
    delete from public.action_requests where created_at < now() - interval '7 days';
    perform internal.log_admin(v_actor, 'season_closed', null, jsonb_build_object('season', p_season));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.list_seasons() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows jsonb;
  v_detail text;
begin
  perform internal.require_rank(3);
  select coalesce(jsonb_agg(row_to_json(t) order by t.id desc), '[]') into v_rows from (
    select id, name, status, map_version, config, war_starts_at, started_at, war_started_at, closed_at, created_at
    from public.seasons
  ) t;
  return jsonb_build_object('ok', true, 'rows', v_rows);
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

/* ---------- Modérer : officiers ---------- */

-- Retire un joueur de la saison en cours : ses territoires redeviennent libres.
create function internal.remove_from_active_season(p_user uuid, p_actor uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_season_id bigint;
begin
  select id into v_season_id from public.seasons where status in ('expansion', 'war') limit 1;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(727001, v_season_id::integer);
  if not exists (select 1 from public.players where season_id = v_season_id and user_id = p_user and excluded_at is null) then
    return false;
  end if;
  update public.players set excluded_at = now(), excluded_reason = p_reason where season_id = v_season_id and user_id = p_user;
  delete from public.territory_state where season_id = v_season_id and owner_id = p_user;
  insert into public.game_events (season_id, kind, actor_id) values (v_season_id, 'player_excluded', p_user);
  return true;
end $$;

create function public.exclude_player(p_number integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_target public.profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    if v_reason is null or char_length(v_reason) > 300 then perform internal.fail('invalid_reason'); end if;
    select * into v_target from public.profiles where gaul_number = p_number;
    if not found then perform internal.fail('user_not_found'); end if;
    if v_target.user_id = v_actor then perform internal.fail('not_on_yourself'); end if;
    if internal.rank_of(v_target.role) >= internal.current_rank() then perform internal.fail('forbidden'); end if;
    if not internal.remove_from_active_season(v_target.user_id, v_actor, v_reason) then
      perform internal.fail('player_not_found');
    end if;
    perform internal.log_admin(v_actor, 'player_excluded', v_target.user_id, jsonb_build_object('reason', v_reason));
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

-- Le joueur peut revenir, en choisissant un nouveau territoire de départ s'il en reste.
create function public.reinstate_player(p_number integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_target uuid;
  v_season_id bigint;
  v_detail text;
begin
  if internal.limit_exceeded() then return internal.error_json('rate_limited', ''); end if;
  begin
    v_actor := internal.require_rank(2);
    select user_id into v_target from public.profiles where gaul_number = p_number;
    if not found then perform internal.fail('user_not_found'); end if;
    select id into v_season_id from public.seasons where status in ('expansion', 'war') limit 1;
    if not found then perform internal.fail('no_active_season'); end if;
    perform pg_advisory_xact_lock(727001, v_season_id::integer);
    update public.players set excluded_at = null, excluded_reason = null
    where season_id = v_season_id and user_id = v_target and excluded_at is not null;
    if not found then perform internal.fail('player_not_found'); end if;
    perform internal.log_admin(v_actor, 'player_reinstated', v_target);
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

create function public.list_excluded_players() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows jsonb;
  v_detail text;
begin
  perform internal.require_rank(2);
  select coalesce(jsonb_agg(row_to_json(t)), '[]') into v_rows from (
    select p.gaul_number as number, p.display_name as name, g.excluded_at, g.excluded_reason
    from public.players g
    join public.profiles p on p.user_id = g.user_id
    join public.seasons s on s.id = g.season_id
    where s.status in ('expansion', 'war') and g.excluded_at is not null
    order by g.excluded_at desc
  ) t;
  return jsonb_build_object('ok', true, 'rows', v_rows);
exception when sqlstate 'GA001' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return internal.error_json(sqlerrm, v_detail);
end $$;

/* ---------- L'historique : public ---------- */

create function public.get_season_history() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', true, 'rows', coalesce(jsonb_agg(row_to_json(t) order by t.id desc), '[]')) from (
    select s.id, s.name, s.started_at, s.closed_at, s.map_version,
      (select e from jsonb_array_elements(s.final_standings) e where (e ->> 'rank_territories')::integer = 1 limit 1) as biggest,
      (select e from jsonb_array_elements(s.final_standings) e
        where (e ->> 'rank_conquerors')::integer = 1 and (e ->> 'captured')::integer > 0 limit 1) as conqueror
    from public.seasons s
    where s.status = 'closed'
  ) t
$$;

create function public.get_closed_season(p_season bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object(
        'ok', true,
        'id', s.id,
        'name', s.name,
        'map_version', s.map_version,
        'started_at', s.started_at,
        'closed_at', s.closed_at,
        'standings', s.final_standings,
        'territories', s.final_map,
        'donors', s.final_donors
      )
      from public.seasons s
      where s.id = p_season and s.status = 'closed'),
    internal.error_json('season_not_found', '')
  )
$$;

/* ---------- Pour la collecte : événements à annoncer et sauvegarde ---------- */

create function public.list_events_to_notify(p_limit integer default 20) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', true, 'rows', coalesce(jsonb_agg(row_to_json(t) order by t.id), '[]')) from (
    select e.id, e.at, e.kind, e.capsules, e.sent,
      case when e.kind = 'donation' and a.anonymous_donations then null else a.display_name end as actor,
      d.display_name as target, t.name as territory, s.name as season
    from public.game_events e
    join public.seasons s on s.id = e.season_id
    left join public.profiles a on a.user_id = e.actor_id
    left join public.profiles d on d.user_id = e.target_id
    left join public.territories t on t.map_version = s.map_version and t.id = e.territory_id
    where e.notified_at is null and e.kind in ('season_started', 'war_started', 'season_closed', 'attack_won', 'donation')
    order by e.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ) t
$$;

create function public.mark_events_notified(p_ids jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_ids) <> 'array' then return internal.error_json('invalid_request', ''); end if;
  update public.game_events set notified_at = now()
  where id in (select (value)::bigint from jsonb_array_elements_text(p_ids));
  return jsonb_build_object('ok', true);
end $$;

-- Quand la tâche planifiée a fait quoi pour la dernière fois : elle tourne toutes les heures, certaines étapes une fois par jour.
create function public.get_job_marks() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'roster_read_at', (select value ->> 'read_at' from public.app_state where key = 'roster'),
    'backup_at', (select value ->> 'at' from public.app_state where key = 'backup_at'),
    'newest_donation_at', (select max(donated_at) from public.openfront_donations)
  )
$$;

create function public.set_job_mark(p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_key is distinct from 'backup_at' then return internal.error_json('invalid_request', ''); end if;
  insert into public.app_state (key, value) values (p_key, jsonb_build_object('at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Tout ce qui ne peut pas se reconstruire. Le fichier produit est chiffré par la collecte.
create function public.export_all() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'exported_at', now(),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.profiles t),
    'private_links', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.private_links t),
    'membership_requests', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.membership_requests t),
    'donations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.donations t),
    'openfront_donations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.openfront_donations t),
    'seasons', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.seasons t),
    'players', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.players t),
    'territory_state', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.territory_state t),
    'game_events', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.game_events t),
    'admin_log', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.admin_log t)
  )
$$;
