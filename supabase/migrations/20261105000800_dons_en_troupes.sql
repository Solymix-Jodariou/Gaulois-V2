-- Les dons deviennent des troupes, tout de suite.
--
-- Pendant une saison, chaque capsule donnée arrive en renfort dans la réserve du donneur :
-- 100 troupes par capsule (la règle réelle de la carte du clan), dans la limite de sa capacité.
-- Le chemin d'un don ne change rien : validé par un officier aujourd'hui, ou lu chez OpenFront
-- le jour où OpenFront donnera un accès, il passe par internal.grant_donation_troops.

/* ---------- Les règles ---------- */

-- Un don daté du jour où la saison a commencé n'en fait partie que s'il a été enregistré après son lancement.
create function internal.in_season(p_on date, p_created timestamptz, p_started timestamptz) returns boolean
language sql stable as $$
  select p_started is not null and (
    p_on > (p_started at time zone 'Europe/Paris')::date
    or (p_on = (p_started at time zone 'Europe/Paris')::date and p_created >= p_started)
  )
$$;

-- `donationTroops` dans src/lib/conquete/rules.ts : un test vérifie que les deux s'accordent.
create function internal.donation_troops(p_capsules bigint, p_troops bigint, p_capacity float8, c jsonb) returns bigint
language sql immutable as $$
  select least(
    floor(greatest(p_capsules, 0)::float8 * (c ->> 'troopsPerCapsule')::float8)::bigint,
    greatest(floor(p_capacity)::bigint - p_troops, 0)
  )
$$;

create function internal.season_capsules(p_user uuid, p_season public.seasons) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(d.capsules), 0)::bigint
  from public.donations d
  where d.user_id = p_user and d.status = 'approved' and d.kind = 'donation'
    and internal.in_season(d.donated_on, d.created_at, p_season.started_at)
$$;

-- La réserve de quelqu'un qui entre dans la saison : son départ, plus ses dons faits depuis le lancement.
create function internal.start_reserve(p_user uuid, p_capsules bigint, p_season public.seasons) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select internal.start_troops(p_capsules, p_season.config)
    + internal.donation_troops(
        internal.season_capsules(p_user, p_season),
        internal.start_troops(p_capsules, p_season.config),
        internal.capacity(0, p_capsules, p_season.config),
        p_season.config
      )
$$;

-- Prend le verrou de la saison en cours, s'il y en a une. Toujours avant de toucher à un don ou à un profil :
-- c'est l'ordre des actions de jeu, et deux ordres différents finiraient par se bloquer l'un l'autre.
create function internal.lock_open_season() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
begin
  select id into v_id from public.seasons where status in ('expansion', 'war') limit 1;
  if found then perform pg_advisory_xact_lock(727001, v_id::integer); end if;
end $$;

/* ---------- Le don arrive en renfort ---------- */

-- Renvoie les troupes données. Le don est déjà validé, et compte déjà dans le total de capsules.
create function internal.grant_donation_troops(p_donation bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_donation public.donations;
  v_season public.seasons;
  v_player public.players;
  v_capsules bigint;
  v_capacity float8;
  v_granted bigint;
begin
  select * into v_donation from public.donations where id = p_donation;
  if not found or v_donation.status <> 'approved' or v_donation.kind <> 'donation' then return 0; end if;
  perform internal.lock_open_season();
  select * into v_season from public.seasons where status in ('expansion', 'war') limit 1;
  if not found or not internal.in_season(v_donation.donated_on, v_donation.created_at, v_season.started_at) then return 0; end if;

  -- Pas encore dans la saison : ses dons l'attendent, voir internal.start_reserve.
  v_player := internal.touch_player(v_season, v_donation.user_id);
  if v_player.user_id is null or v_player.excluded_at is not null then return 0; end if;

  select capsules_total into v_capsules from public.profiles where user_id = v_donation.user_id;
  v_capacity := internal.capacity(internal.territory_count(v_season.id, v_donation.user_id), v_capsules, v_season.config);
  v_granted := internal.donation_troops(v_donation.capsules, v_player.troops, v_capacity, v_season.config);

  update public.players set troops = troops + v_granted where season_id = v_season.id and user_id = v_donation.user_id;
  update public.donations set troops_granted = v_granted, troops_season = v_season.id where id = p_donation;
  insert into public.game_events (season_id, kind, actor_id, sent, capsules)
  values (v_season.id, 'donation', v_donation.user_id, v_granted, v_donation.capsules);
  return v_granted;
end $$;

-- Un don annulé reprend ses troupes, dans la limite de ce qu'il reste dans la réserve.
create function internal.take_back_donation_troops(p_donation public.donations) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_season public.seasons;
  v_player public.players;
  v_taken bigint;
begin
  if p_donation.troops_granted <= 0 then return 0; end if;
  perform internal.lock_open_season();
  select * into v_season from public.seasons where id = p_donation.troops_season and status in ('expansion', 'war');
  if not found then return 0; end if;
  v_player := internal.touch_player(v_season, p_donation.user_id);
  if v_player.user_id is null then return 0; end if;
  v_taken := least(p_donation.troops_granted, v_player.troops);
  update public.players set troops = troops - v_taken where season_id = v_season.id and user_id = p_donation.user_id;
  insert into public.game_events (season_id, kind, actor_id, sent, capsules)
  values (v_season.id, 'donation_cancelled', p_donation.user_id, v_taken, p_donation.capsules);
  return v_taken;
end $$;

/* ---------- La lecture chez OpenFront : éteinte tant qu'OpenFront n'a pas donné d'accès ---------- */

create function internal.donations_synced() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_state where key = 'donations_sync')
$$;

-- La première lecture remplace tout ce qui a été déclaré à la main : son grand livre contient déjà ces dons.
create function internal.begin_donation_sync() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if internal.donations_synced() then return; end if;
  insert into public.file_cleanup (path)
  select screenshot_path from public.donations where screenshot_path is not null
  on conflict (path) do nothing;
  update public.donations
  set status = case when status = 'approved' then 'superseded'::public.donation_status else 'cancelled'::public.donation_status end,
    reason = 'Remplacé par la lecture automatique des dons d''OpenFront.',
    reviewed_at = now(),
    screenshot_path = null
  where status in ('pending', 'approved');
  update public.profiles set capsules_total = 0 where capsules_total <> 0;
  insert into public.app_state (key, value) values ('donations_sync', jsonb_build_object('since', now(), 'read_at', now()));
end $$;

-- Crédite un membre validé des dons du grand livre qui l'attendent. Ceux d'avant la première lecture
-- comptent dans son total, sans donner de troupes : ils ont peut-être déjà été validés à la main.
create function internal.credit_openfront_ledger(p_user uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash text;
  v_since timestamptz;
  v_row public.openfront_donations;
  v_id bigint;
  v_count integer := 0;
begin
  select l.openfront_hash into v_hash
  from public.private_links l
  join public.profiles p on p.user_id = l.user_id
  where l.user_id = p_user and p.status = 'validated';
  if v_hash is null then return 0; end if;
  select (value ->> 'since')::timestamptz into v_since from public.app_state where key = 'donations_sync';
  if v_since is null then return 0; end if;

  perform internal.lock_open_season();
  for v_row in
    select * from public.openfront_donations
    where donor_hash = v_hash and donation_id is null
    order by donated_at, ledger_id
    for update
  loop
    insert into public.donations (user_id, capsules, donated_on, kind, status, created_by, reviewed_at, note, created_at)
    values (p_user, v_row.capsules, (v_row.donated_at at time zone 'Europe/Paris')::date, 'donation', 'approved', p_user, now(), 'Lu chez OpenFront', v_row.donated_at)
    returning id into v_id;
    update public.openfront_donations set donation_id = v_id where ledger_id = v_row.ledger_id;
    update public.profiles set capsules_total = capsules_total + v_row.capsules where user_id = p_user;
    if v_row.donated_at >= v_since then perform internal.grant_donation_troops(v_id); end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Réservée à la clé de service. Tout ou rien : une ligne invalide n'écrit rien, et relire un don n'ajoute rien.
-- Un don dont le donneur n'a pas encore de compte validé attend dans le grand livre.
create function public.ingest_openfront_donations(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_new integer := 0;
  v_known integer := 0;
  v_hash text;
  v_hashes text[] := '{}';
  v_user uuid;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return internal.error_json('invalid_request', ''); end if;
  -- Une réponse vide ne dit rien : elle n'éteint pas les déclarations.
  if jsonb_array_length(p_rows) = 0 and not internal.donations_synced() then
    return jsonb_build_object('ok', true, 'new', 0, 'known', 0);
  end if;
  perform internal.lock_open_season();
  perform internal.begin_donation_sync();

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_hash := v_row ->> 'hash';
    insert into public.openfront_donations (ledger_id, donor_hash, capsules, donated_at)
    values (v_row ->> 'id', v_hash, (v_row ->> 'capsules')::bigint, (v_row ->> 'at')::timestamptz)
    on conflict (ledger_id) do nothing;
    if found then
      v_new := v_new + 1;
      if v_hash is not null then v_hashes := array_append(v_hashes, v_hash); end if;
    else
      v_known := v_known + 1;
    end if;
  end loop;

  for v_user in
    select l.user_id from public.private_links l
    join public.profiles p on p.user_id = l.user_id
    where p.status = 'validated' and l.openfront_hash = any (v_hashes)
    order by p.gaul_number
  loop
    perform internal.credit_openfront_ledger(v_user);
  end loop;

  update public.app_state
  set value = value || jsonb_build_object('read_at', now()), updated_at = now()
  where key = 'donations_sync';
  return jsonb_build_object('ok', true, 'new', v_new, 'known', v_known);
end $$;

/* ---------- Le pouls : quelques octets, pour ne relire la carte que si quelque chose a bougé ---------- */

create function public.get_game_pulse() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ok', true,
    'revision', coalesce(
      (
        select concat_ws('/',
          s.id, s.status, extract(epoch from s.war_starts_at)::bigint, md5(s.config::text),
          (select max(e.id) from public.game_events e where e.season_id = s.id),
          (select count(*) from public.territory_state t where t.season_id = s.id),
          (select sum(t.garrison) from public.territory_state t where t.season_id = s.id)
        )
        from public.seasons s
        where s.status in ('expansion', 'war')
        order by s.id desc
        limit 1
      ),
      -- Sans saison en cours, la dernière clôturée compte encore : elle fait changer l'historique.
      'aucune/' || coalesce((select max(id)::text from public.seasons where status = 'closed'), '0')
    ),
    'read_at', now()
  )
$$;
