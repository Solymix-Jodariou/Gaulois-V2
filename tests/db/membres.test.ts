import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { ANON, SERVICE, TestDb, asUser, withRole } from "../support/database";

let db: TestDb;
let officer: string;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  officer = await db.addMember("Officier", "officer");
});
afterAll(() => db.close());

const hash = (id: string) => createHash("sha256").update(id).digest("hex");
const ROSTER = [
  { hash: hash("PUB-ASTRA"), username: "Astra", role: "member" },
  { hash: hash("PUB-ANON"), username: null, role: "member" },
  { hash: hash("PUB-CHEF"), username: "Brenn", role: "officer" },
  { hash: hash("PUB-DOUBLE-1"), username: "Double", role: "member" },
  { hash: hash("PUB-DOUBLE-2"), username: "double", role: "member" },
];

beforeEach(async () => {
  await db.sql("delete from public.membership_requests");
  await db.sql("update public.private_links set openfront_hash = null");
  await db.rpc(SERVICE, "sync_clan_roster", { p_entries: ROSTER, p_total: ROSTER.length });
});

const requestOf = async (id: string) => {
  const rows = await db.sql<{ id: string; status: string; in_roster: boolean; claimed_text: string | null; roster_username: string | null; openfront_hash: string }>(
    "select id, status, in_roster, claimed_text, roster_username, openfront_hash from public.membership_requests where user_id = $1 order by id desc limit 1",
    [id],
  );
  return rows[0]!;
};

describe("la liste des membres", () => {
  it("n'est écrite que par la collecte", async () => {
    const member = await db.addMember("Curieux");
    await expect(db.rpc(asUser(member), "sync_clan_roster", { p_entries: ROSTER, p_total: 5 })).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(ANON, "sync_clan_roster", { p_entries: ROSTER, p_total: 5 })).rejects.toMatchObject({ code: "42501" });
    await expect(withRole(db.pool, asUser(member), (c) => c.query("select * from public.clan_roster"))).rejects.toMatchObject({ code: "42501" });
  });

  it("une liste incomplète ne remplace jamais la dernière liste valide", async () => {
    expect(await db.rpc(SERVICE, "sync_clan_roster", { p_entries: ROSTER.slice(0, 2), p_total: 5 })).toMatchObject({ ok: false, error: "roster_incomplete" });
    const [row] = await db.sql<{ n: string }>("select count(*) n from public.clan_roster");
    expect(Number(row!.n)).toBe(ROSTER.length);
  });

  it("ne contient aucun identifiant en clair", async () => {
    const rows = await db.sql<{ public_id_hash: string }>("select public_id_hash from public.clan_roster");
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.public_id_hash))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("PUB-");
  });
});

describe("lier un profil OpenFront", () => {
  it("par identifiant public : reconnu, et l'identifiant n'est pas conservé", async () => {
    const id = await db.addUser("Joueur1");
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: " PUB-ASTRA " })).toMatchObject({ ok: true, in_roster: true, roster_username: "Astra" });
    const request = await requestOf(id);
    expect(request).toMatchObject({ status: "pending", in_roster: true, claimed_text: null, roster_username: "Astra", openfront_hash: hash("PUB-ASTRA") });
  });

  it("par pseudo, sans tenir compte des majuscules", async () => {
    const id = await db.addUser("Joueur2");
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "bReNn" })).toMatchObject({ ok: true, in_roster: true, roster_username: "Brenn" });
    expect((await requestOf(id)).openfront_hash).toBe(hash("PUB-CHEF"));
  });

  it("un membre sans pseudo public passe par son identifiant", async () => {
    const id = await db.addUser("Joueur3");
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "PUB-ANON" })).toMatchObject({ ok: true, in_roster: true, roster_username: null });
  });

  it("un pseudo porté par deux membres demande l'identifiant", async () => {
    const id = await db.addUser("Joueur4");
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "DOUBLE" })).toMatchObject({ ok: false, error: "ambiguous_pseudo" });
  });

  it("hors de la liste, la demande part quand même, signalée à l'officier", async () => {
    const id = await db.addUser("Joueur5");
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Inconnu", p_note: "Arrivé ce matin" })).toMatchObject({ ok: true, in_roster: false });
    expect(await requestOf(id)).toMatchObject({ in_roster: false, claimed_text: "Inconnu" });
  });

  it("refuse les entrées vides, trop longues, et une seconde demande ouverte", async () => {
    const id = await db.addUser("Joueur6");
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "   " })).toMatchObject({ ok: false, error: "invalid_claim" });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "x".repeat(65) })).toMatchObject({ ok: false, error: "invalid_claim" });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Astra", p_note: "x".repeat(301) })).toMatchObject({ ok: false, error: "invalid_note" });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Brenn" })).toMatchObject({ ok: false, error: "request_open" });
  });

  it("un visiteur ne peut pas demander, et une demande s'annule", async () => {
    await expect(db.rpc(ANON, "request_membership", { p_claim: "Astra" })).rejects.toMatchObject({ code: "42501" });
    const id = await db.addUser("Joueur7");
    expect(await db.rpc(asUser(id), "cancel_membership_request")).toMatchObject({ ok: false, error: "no_open_request" });
    await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" });
    expect(await db.rpc(asUser(id), "cancel_membership_request")).toMatchObject({ ok: true });
    expect((await requestOf(id)).status).toBe("cancelled");
  });
});

describe("tant que le compte n'est pas validé", () => {
  it("il ne voit que son statut : aucune action de membre", async () => {
    const id = await db.addUser("EnAttente");
    await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" });
    // Taper l'identifiant d'un membre de la liste ne suffit pas : c'est public.
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", rank: 0, request: { status: "pending", in_roster: true } });
    expect(await db.rpc(asUser(id), "list_membership_requests")).toMatchObject({ ok: false, error: "not_validated" });
    expect(await db.rpc(asUser(id), "list_members")).toMatchObject({ ok: false, error: "not_validated" });
  });
});

describe("la décision de l'officier", () => {
  it("valider donne le statut de membre, le pseudo public, et laisse une trace", async () => {
    const id = await db.addUser("Valide1");
    await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" });
    const request = await requestOf(id);
    const list = await db.rpc<{ rows: { id: number; in_roster: boolean; discord_name: string }[]; roster: { total: number } }>(asUser(officer), "list_membership_requests");
    expect(list.rows.find((r) => String(r.id) === request.id)).toMatchObject({ in_roster: true, discord_name: "Valide1" });
    expect(list.roster.total).toBe(ROSTER.length);

    expect(await db.rpc(asUser(officer), "review_membership", { p_request: request.id, p_approve: true })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "validated", rank: 1, name: "Astra", linked: true, openfront_username: "Astra" });
    const log = await db.sql<{ actor_id: string }>("select actor_id from public.admin_log where action = 'membership_approved' and target_id = $1", [id]);
    expect(log[0]!.actor_id).toBe(officer);
  });

  it("un membre sans pseudo public garde un nom neutre : son identifiant n'apparaît nulle part", async () => {
    const id = await db.addUser("Valide2");
    await db.rpc(asUser(id), "request_membership", { p_claim: "PUB-ANON" });
    await db.rpc(asUser(officer), "review_membership", { p_request: (await requestOf(id)).id, p_approve: true });
    const me = await db.rpc<{ name: string }>(asUser(id), "get_me");
    expect(me.name).toMatch(/^Gaulois n° \d+$/);
    const [row] = await db.sql("select l.*, r.claimed_text from public.private_links l join public.membership_requests r on r.user_id = l.user_id where l.user_id = $1", [id]);
    expect(JSON.stringify(row)).not.toContain("PUB-ANON");
  });

  it("refuser laisse le compte en attente, avec la raison, et permet de recommencer", async () => {
    const id = await db.addUser("Refuse1");
    await db.rpc(asUser(id), "request_membership", { p_claim: "Inconnu" });
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: (await requestOf(id)).id, p_approve: false, p_reason: "Pas dans le clan" })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(id), "get_me")).toMatchObject({ status: "pending", rank: 0, request: { status: "refused", reason: "Pas dans le clan" } });
    expect(await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" })).toMatchObject({ ok: true });
  });

  it("un joueur OpenFront ne se lie qu'à un seul compte : un usurpateur ne bloque pas le vrai membre", async () => {
    const impostor = await db.addUser("Usurpateur");
    const real = await db.addUser("LeVrai");
    await db.rpc(asUser(impostor), "request_membership", { p_claim: "Brenn" });
    await db.rpc(asUser(real), "request_membership", { p_claim: "PUB-CHEF" });
    // L'officier reconnaît le vrai membre : la demande de l'usurpateur se ferme d'elle-même.
    await db.rpc(asUser(officer), "review_membership", { p_request: (await requestOf(real)).id, p_approve: true });
    expect(await requestOf(impostor)).toMatchObject({ status: "refused" });
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: (await requestOf(impostor)).id, p_approve: true })).toMatchObject({ ok: false, error: "request_closed" });

    const late = await db.addUser("Retardataire");
    expect(await db.rpc(asUser(late), "request_membership", { p_claim: "Brenn" })).toMatchObject({ ok: false, error: "already_linked" });
  });

  it("une décision ne se prend qu'une fois, et jamais par un simple membre", async () => {
    const id = await db.addUser("Une1");
    const member = await db.addMember("SimpleMembre");
    await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" });
    const { id: requestId } = await requestOf(id);
    expect(await db.rpc(asUser(member), "review_membership", { p_request: requestId, p_approve: true })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(id), "review_membership", { p_request: requestId, p_approve: true })).toMatchObject({ ok: false, error: "not_validated" });
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: requestId, p_approve: true })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: requestId, p_approve: false })).toMatchObject({ ok: false, error: "request_closed" });
  });
});

describe("les officiers retrouvent les membres", () => {
  it("par nom, avec leur présence dans la liste", async () => {
    const id = await db.addUser("DiscordRecherche");
    await db.rpc(asUser(id), "request_membership", { p_claim: "Astra" });
    await db.rpc(asUser(officer), "review_membership", { p_request: (await requestOf(id)).id, p_approve: true });
    const found = await db.rpc<{ rows: { name: string; in_roster: boolean; linked: boolean }[] }>(asUser(officer), "list_members", { p_search: "discordrech" });
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]).toMatchObject({ name: "Astra", in_roster: true, linked: true });
    await db.rpc(SERVICE, "sync_clan_roster", { p_entries: ROSTER.slice(1), p_total: ROSTER.length - 1 });
    const after = await db.rpc<{ rows: { in_roster: boolean }[] }>(asUser(officer), "list_members", { p_search: "discordrech" });
    expect(after.rows[0]!.in_roster).toBe(false);
  });
});
