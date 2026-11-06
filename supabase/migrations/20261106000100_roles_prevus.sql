-- Les rôles prévus : la direction note à l'avance l'identifiant Discord de son encadrement.
-- À sa demande, la personne est reconnue : elle est validée avec son rôle, sans attendre un officier.
--
-- Elle passe quand même par la demande : un compte validé ne peut plus lier son profil OpenFront,
-- et resterait « Gaulois n° … » dans le jeu. La connexion elle-même ne change pas.
--
-- Seul compte l'identifiant lu dans auth.identities (voir internal.sync_discord_identity), qui ne
-- s'écrit pas depuis le navigateur. La liste n'est pas dans ce dépôt, qui est public : elle se remplit
-- depuis l'éditeur SQL de Supabase, voir docs/DIRECTION.md.

create table internal.role_presets (
  discord_id text primary key check (discord_id ~ '^[0-9]{17,20}$'),
  -- Jamais fondateur : ce rôle ne se prévoit pas, il se transmet.
  role public.site_role not null check (role in ('officer', 'admin')),
  created_at timestamptz not null default now()
);
revoke all on internal.role_presets from public, anon, authenticated;

/* ---------- Valider une demande : un seul chemin, pour un officier comme pour un rôle prévu ---------- */

create function internal.approve_membership(p_request public.membership_requests, p_actor uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.site_role;
begin
  update public.membership_requests
  set status = 'approved', reason = p_reason, decided_by = p_actor, decided_at = now()
  where id = p_request.id;
  update public.private_links
  set openfront_hash = p_request.openfront_hash, openfront_username = p_request.roster_username, linked_at = now()
  where user_id = p_request.user_id;
  -- Le pseudo public de la liste devient le nom de jeu. Sans pseudo public, le joueur reste « Gaulois n° … ».
  update public.profiles
  set status = 'validated', validated_at = now(), status_reason = null, display_name = coalesce(left(p_request.roster_username, 64), display_name)
  where user_id = p_request.user_id;
  -- Un seul compte par joueur OpenFront : les autres demandes pour ce joueur se ferment.
  update public.membership_requests
  set status = 'refused', reason = 'Ce joueur OpenFront est déjà lié à un autre compte.', decided_by = p_actor, decided_at = now()
  where openfront_hash = p_request.openfront_hash and status = 'pending';
  -- Ses dons déjà lus chez OpenFront lui reviennent, maintenant qu'on sait qui il est.
  perform internal.credit_openfront_ledger(p_request.user_id);
  perform internal.log_admin(p_actor, 'membership_approved', p_request.user_id, jsonb_build_object('in_roster', p_request.in_roster));

  -- L'entrée ne sert qu'une fois, puis disparaît : une rétrogradation tiendra.
  delete from internal.role_presets p
  using public.private_links l
  where l.user_id = p_request.user_id and p.discord_id = l.discord_id
  returning p.role into v_role;
  if v_role is not null then
    -- Un fondateur désigné entre-temps garde son rôle.
    update public.profiles set role = v_role where user_id = p_request.user_id and role = 'member';
    if found then
      perform internal.log_admin(p_actor, 'role_preset_applied', p_request.user_id, jsonb_build_object('role', v_role));
    end if;
  end if;
end $$;

revoke all on function internal.approve_membership(public.membership_requests, uuid, text) from public, anon, authenticated;

create or replace function public.review_membership(p_request bigint, p_approve boolean, p_reason text default null) returns jsonb
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

    perform internal.approve_membership(v_request, v_actor, v_reason);
    return jsonb_build_object('ok', true);
  exception when sqlstate 'GA001' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return internal.error_json(sqlerrm, v_detail);
  end;
end $$;

/* ---------- La demande d'une personne prévue se valide d'elle-même ---------- */

-- Un pseudo absent de la liste des membres peut être une faute de frappe : la demande attend alors
-- un officier, qui peut la refuser, et le rôle arrivera à sa validation.
create function internal.approve_planned_member() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.in_roster and exists (
    select 1 from internal.role_presets p
    join public.private_links l on l.discord_id = p.discord_id
    where l.user_id = new.user_id
  ) then
    perform internal.approve_membership(new, new.user_id, 'Rôle prévu par la direction.');
  end if;
  return new;
end $$;

revoke all on function internal.approve_planned_member() from public, anon, authenticated;

create trigger membership_planned_role after insert on public.membership_requests
  for each row execute function internal.approve_planned_member();
