-- Dernière migration : qui peut appeler quoi.
--
-- Supabase donne par défaut le droit d'exécuter toute nouvelle fonction. On retire tout,
-- puis on rend explicitement chaque fonction. Une fonction absente de cette liste n'est
-- donc appelable par personne depuis le navigateur.

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal') and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function.signature);
  end loop;
end $$;

-- Sert aux règles d'accès, sous le rôle de l'appelant.
grant execute on function internal.current_rank() to authenticated;

-- Tout le monde, même sans compte : ce qui est public.
grant execute on function public.get_donor_ranking() to anon, authenticated;
grant execute on function public.get_game_state() to anon, authenticated;
grant execute on function public.get_game_pulse() to anon, authenticated;
grant execute on function public.get_feed(bigint, bigint, integer) to anon, authenticated;
grant execute on function public.get_season_history() to anon, authenticated;
grant execute on function public.get_closed_season(bigint) to anon, authenticated;

-- Tout compte connecté, même en attente de validation.
grant execute on function public.get_me() to authenticated;
grant execute on function public.request_membership(text, text) to authenticated;
grant execute on function public.cancel_membership_request() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Membres validés : la fonction le vérifie elle-même.
grant execute on function public.declare_donation(uuid, bigint, date, text, text) to authenticated;
grant execute on function public.get_my_donations() to authenticated;
grant execute on function public.set_donation_anonymity(boolean) to authenticated;
grant execute on function public.get_my_game() to authenticated;
grant execute on function public.choose_start(uuid, integer, bigint) to authenticated;
grant execute on function public.expand(uuid, integer, bigint) to authenticated;
grant execute on function public.reinforce(uuid, integer, bigint) to authenticated;
grant execute on function public.attack(uuid, integer, bigint) to authenticated;

-- Officiers et au-dessus : la fonction le vérifie elle-même.
grant execute on function public.list_membership_requests(public.request_status) to authenticated;
grant execute on function public.review_membership(bigint, boolean, text) to authenticated;
grant execute on function public.list_members(text, integer) to authenticated;
grant execute on function public.list_donations(public.donation_status, integer) to authenticated;
grant execute on function public.review_donation(bigint, boolean, text) to authenticated;
grant execute on function public.enter_donation(uuid, uuid, bigint, date, public.donation_kind, text) to authenticated;
grant execute on function public.cancel_donation(bigint, text) to authenticated;
grant execute on function public.exclude_player(integer, text) to authenticated;
grant execute on function public.reinstate_player(integer) to authenticated;
grant execute on function public.list_excluded_players() to authenticated;

-- Admins et au-dessus : la fonction le vérifie elle-même.
grant execute on function public.set_member_role(uuid, public.site_role) to authenticated;
grant execute on function public.suspend_member(uuid, text) to authenticated;
grant execute on function public.reinstate_member(uuid) to authenticated;
grant execute on function public.list_admin_log(integer) to authenticated;
grant execute on function public.create_season(text, jsonb, text) to authenticated;
grant execute on function public.update_season_config(bigint, jsonb) to authenticated;
grant execute on function public.start_season(bigint, timestamptz) to authenticated;
grant execute on function public.set_war_date(bigint, timestamptz) to authenticated;
grant execute on function public.close_season(bigint) to authenticated;
grant execute on function public.list_seasons() to authenticated;

-- Clé de service seulement : la collecte, jamais le navigateur.
grant execute on function public.bootstrap_founder(text) to service_role;
grant execute on function public.sync_clan_roster(jsonb, integer) to service_role;
grant execute on function public.ingest_openfront_donations(jsonb) to service_role;
grant execute on function public.list_file_cleanup() to service_role;
grant execute on function public.confirm_file_cleanup(jsonb) to service_role;
grant execute on function public.list_events_to_notify(integer) to service_role;
grant execute on function public.mark_events_notified(jsonb) to service_role;
grant execute on function public.export_all() to service_role;
grant execute on function public.get_job_marks() to service_role;
grant execute on function public.set_job_mark(text) to service_role;
