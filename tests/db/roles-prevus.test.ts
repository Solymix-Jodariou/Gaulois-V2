import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ANON, SERVICE, TestDb, asUser, withRole } from "../support/database";

const PSEUDOS = ["Arverne", "Eduen", "Sequane", "Carnute", "Senon", "Trevire", "Morvan", "Tarvos", "Lemovice"];
const ROSTER = PSEUDOS.map((username) => ({ hash: username.padEnd(64, "0"), username, role: "member" }));

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  await db.rpc(SERVICE, "sync_clan_roster", { p_entries: ROSTER, p_total: ROSTER.length });
});
afterAll(() => db.close());

let lastId = 100_000_000_000_000_000n;
const newDiscordId = () => String(++lastId);

/** Une vraie connexion Discord : l'identité vient de auth.identities. */
const connect = async (discordId: string, name = "Quelqu'un") => (await db.sql<{ id: string }>("insert into auth.users (raw_user_meta_data) values ($1) returning id", [JSON.stringify({ provider_id: discordId, full_name: name })]))[0]!.id;
const signInAgain = (id: string) => db.sql("update auth.users set last_sign_in_at = now() + interval '1 minute' where id = $1", [id]);
const plan = (discordId: string, role: string) => db.sql("insert into internal.role_presets (discord_id, role) values ($1, $2)", [discordId, role]);
const isPlanned = async (discordId: string) => (await db.sql<{ n: number }>("select count(*)::int as n from internal.role_presets where discord_id = $1", [discordId]))[0]!.n === 1;
const openRequestOf = async (officer: string, discordId: string) => {
  const { rows } = await db.rpc<{ rows: { id: number; discord_id: string }[] }>(asUser(officer), "list_membership_requests");
  return rows.find((r) => r.discord_id === discordId)!.id;
};

describe("une personne prévue par la direction", () => {
  it("n'a aucun droit tant qu'elle n'a pas fait sa demande, puis reçoit tout d'un coup, sans officier", async () => {
    const discordId = newDiscordId();
    await plan(discordId, "admin");
    const id = await connect(discordId, "NomDiscord");
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", role: "member", rank: 0 });

    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Arverne" })).toMatchObject({ ok: true, in_roster: true, roster_username: "Arverne" });

    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ name: "Arverne", status: "validated", role: "admin", rank: 3, linked: true, openfront_username: "Arverne", discord_name: "NomDiscord", request: { status: "approved" } });
    expect(await db.rpc(asUser(id), "list_admin_log")).toMatchObject({ ok: true });
    expect(await isPlanned(discordId)).toBe(false);

    const log = await db.sql<{ action: string; actor_id: string; details: { role?: string } }>("select action, actor_id, details from public.admin_log where target_id = $1 order by id", [id]);
    expect(log.map((l) => l.action)).toEqual(["membership_approved", "role_preset_applied"]);
    expect(log[1]).toMatchObject({ actor_id: id, details: { role: "admin" } });
  });

  it("n'a que les droits de son rôle : un officier prévu ne nomme personne", async () => {
    const discordId = newDiscordId();
    await plan(discordId, "officer");
    const id = await connect(discordId);
    await db.rpc(asUser(id), "request_membership", { p_claim: "Eduen" });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "validated", role: "officer", rank: 2 });
    expect(await db.rpc(asUser(id), "list_membership_requests")).toMatchObject({ ok: true });
    const target = await db.addMember("CibleOfficier");
    expect(await db.rpc(asUser(id), "set_member_role", { p_user: target, p_role: "officer" })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("une faute de frappe attend un officier, qui peut refuser : la personne reste prévue et se rattrape", async () => {
    const officer = await db.addMember("OffFrappe", "officer");
    const discordId = newDiscordId();
    await plan(discordId, "officer");
    const id = await connect(discordId);

    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Sequanne" })).toMatchObject({ ok: true, in_roster: false });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", rank: 0 });
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: await openRequestOf(officer, discordId), p_approve: false, p_reason: "Faute de frappe" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", role: "member", rank: 0 });
    expect(await isPlanned(discordId)).toBe(true);

    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Sequane" })).toMatchObject({ ok: true, in_roster: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ name: "Sequane", status: "validated", role: "officer" });
  });

  it("absente de la liste des membres, elle reçoit son rôle quand un officier valide sa demande", async () => {
    const officer = await db.addMember("OffAbsent", "officer");
    const discordId = newDiscordId();
    await plan(discordId, "admin");
    const id = await connect(discordId);
    await db.rpc(asUser(id), "request_membership", { p_claim: "Arrivé ce matin" });
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: await openRequestOf(officer, discordId), p_approve: true })).toMatchObject({ ok: true });
    const me = await db.rpc(asUser(id), "get_me");
    expect(me).toMatchObject({ status: "validated", role: "admin", rank: 3 });
    expect(me.name).toMatch(/^Gaulois n° \d+$/);
    expect(await isPlanned(discordId)).toBe(false);
  });

  it("n'en profite qu'une fois : rétrogradée, elle le reste après une nouvelle connexion", async () => {
    const founder = await db.addMember("FondPrevu", "founder");
    const discordId = newDiscordId();
    await plan(discordId, "admin");
    const id = await connect(discordId);
    await db.rpc(asUser(id), "request_membership", { p_claim: "Carnute" });
    expect(await db.rpc(asUser(founder), "set_member_role", { p_user: id, p_role: "member" })).toMatchObject({ ok: true });

    await signInAgain(id);
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ role: "member", rank: 1 });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Carnute" })).toMatchObject({ ok: false, error: "already_validated" });
  });

  it("suspendue, elle n'obtient rien", async () => {
    const admin = await db.addMember("AdmSuspPrevu", "admin");
    const discordId = newDiscordId();
    await plan(discordId, "admin");
    const id = await connect(discordId);
    await db.rpc(asUser(admin), "suspend_member", { p_user: id, p_reason: "Doute" });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Senon" })).toMatchObject({ ok: false, error: "suspended" });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "suspended", rank: 0 });
  });

  it("un fondateur sur la liste garde son rôle", async () => {
    const discordId = newDiscordId();
    const id = await connect(discordId);
    await db.rpc(asUser(id), "request_membership", { p_claim: "Hors liste" });
    await db.sql("update public.profiles set role = 'founder', status = 'validated', validated_at = now() where user_id = $1", [id]);
    await plan(discordId, "admin");
    expect(await db.rpc(asUser(id), "review_membership", { p_request: await openRequestOf(id, discordId), p_approve: true })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ role: "founder", rank: 4 });
    expect(await isPlanned(discordId)).toBe(false);
  });
});

describe("ce que les rôles prévus ne permettent pas", () => {
  it("quelqu'un qui n'est pas sur la liste attend un officier, comme avant", async () => {
    const id = await connect(newDiscordId());
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Trevire" })).toMatchObject({ ok: true, in_roster: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", role: "member", rank: 0, request: { status: "pending" } });
  });

  it("écrire l'identifiant d'un autre dans ses métadonnées ne donne rien", async () => {
    const planned = newDiscordId();
    await plan(planned, "admin");
    const thief = await connect(newDiscordId(), "Voleur");
    await db.sql("update auth.users set raw_user_meta_data = raw_user_meta_data || $2 where id = $1", [thief, JSON.stringify({ provider_id: planned, sub: planned })]);
    await signInAgain(thief);
    await db.rpc(asUser(thief), "request_membership", { p_claim: "Lemovice" });
    expect(await db.rpc(asUser(thief), "get_me")).toMatchObject({ status: "pending", role: "member", rank: 0 });
    expect(await isPlanned(planned)).toBe(true);
  });

  it("un compte créé par e-mail avec cet identifiant ne peut même pas faire de demande", async () => {
    const planned = newDiscordId();
    await plan(planned, "admin");
    const [row] = await db.sql<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ('x@example.test', $1) returning id", [JSON.stringify({ sub: planned, full_name: "Voleur" })]);
    expect(await db.rpc(asUser(row!.id), "request_membership", { p_claim: "Lemovice" })).toMatchObject({ ok: false, error: "discord_required" });
    expect(await isPlanned(planned)).toBe(true);
  });

  it("un joueur déjà lié reste refusé, et la personne reste prévue", async () => {
    const first = newDiscordId();
    await plan(first, "officer");
    await db.rpc(asUser(await connect(first)), "request_membership", { p_claim: "Morvan" });

    const second = newDiscordId();
    await plan(second, "admin");
    const id = await connect(second);
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Morvan" })).toMatchObject({ ok: false, error: "already_linked" });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", role: "member", rank: 0 });
    expect(await isPlanned(second)).toBe(true);
  });

  it("l'imposteur arrivé avant voit sa demande fermée quand le vrai joueur est reconnu", async () => {
    const impostor = await connect(newDiscordId(), "Imposteur");
    await db.rpc(asUser(impostor), "request_membership", { p_claim: "Tarvos" });

    const discordId = newDiscordId();
    await plan(discordId, "officer");
    const id = await connect(discordId);
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Tarvos" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ name: "Tarvos", status: "validated", role: "officer" });
    expect(await db.rpc(asUser(impostor), "get_me")).toMatchObject({ status: "pending", rank: 0, request: { status: "refused" } });
  });

  it("n'accepte ni fondateur, ni simple membre, ni identifiant mal formé", async () => {
    await expect(plan(newDiscordId(), "founder")).rejects.toMatchObject({ code: "23514" });
    await expect(plan(newDiscordId(), "member")).rejects.toMatchObject({ code: "23514" });
    await expect(plan("Pseudo#1234", "admin")).rejects.toMatchObject({ code: "23514" });
  });

  it("personne ne lit ni n'écrit la liste depuis l'extérieur, clé de service comprise", async () => {
    const member = await db.addMember("CurieuxPrevu");
    const officer = await db.addMember("OffCurieux", "officer");
    for (const caller of [ANON, asUser(member), asUser(officer), SERVICE]) {
      for (const sql of ["select * from internal.role_presets", `insert into internal.role_presets (discord_id, role) values ('${newDiscordId()}', 'admin')`, "delete from internal.role_presets where true"]) {
        await expect(withRole(db.pool, caller, (c) => c.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
      }
    }
  });

  it("ses fonctions ne sont appelables par personne depuis l'extérieur", async () => {
    for (const fn of ["internal.approve_membership(public.membership_requests, uuid, text)", "internal.approve_planned_member()"]) {
      for (const role of ["anon", "authenticated"]) {
        const [row] = await db.sql<{ allowed: boolean }>("select has_function_privilege($1, $2, 'execute') as allowed", [role, fn]);
        expect(row!.allowed, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
