import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { capacity, donationTroops, startingTroops, DEFAULT_CONFIG } from "../../src/lib/conquete/rules";
import { ANON, SERVICE, TestDb, asUser } from "../support/database";
import { chooseStart, clone, enlist, openSeason, place, playerRow, plainsCluster, reinforce } from "../support/game";

let db: TestDb;
let officer: string;
let season: number;
const [land1, land2] = plainsCluster(2) as [number, number];

beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  officer = await db.addMember("OfficierRenforts", "officer");
});
afterAll(() => db.close());

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
const declare = (user: string, capsules: number, day = today()) =>
  db.rpc<{ ok: boolean; id: number; error?: string }>(asUser(user), "declare_donation", { p_request_id: randomUUID(), p_capsules: capsules, p_donated_on: day });
const approve = (id: number) => db.rpc<{ ok: boolean; troops: number }>(asUser(officer), "review_donation", { p_donation: id, p_approve: true });
const give = async (user: string, capsules: number) => approve((await declare(user, capsules)).id);
const feed = async () => (await db.rpc<{ rows: { kind: string; actor: string | null; capsules: number | null; sent: number | null }[] }>(ANON, "get_feed")).rows;
const capsulesOf = async (user: string) => Number((await db.sql<{ c: string }>("select capsules_total c from public.profiles where user_id = $1", [user]))[0]!.c);
const pulse = async () => (await db.rpc<{ revision: string }>(ANON, "get_game_pulse")).revision;
const hash = (id: string) => createHash("sha256").update(id).digest("hex");

/** Un membre validé, déjà sur la carte, avec une réserve connue. */
async function player(name: string, troops: number, territory: number) {
  const user = await db.addMember(name);
  await enlist(db, season, user, troops);
  await place(db, season, user, territory, 1000);
  return user;
}

describe("un don fait pendant la saison", () => {
  beforeEach(async () => {
    season = (await openSeason(db)).id;
  });

  it("arrive tout de suite en renfort : 1 capsule = 100 troupes", async () => {
    const user = await player("Renfort1", 10_000, land1);
    const res = await give(user, 250);
    expect(res).toMatchObject({ ok: true, troops: 25_000 });
    expect((await playerRow(db, season, user))!.troops).toBe(35_000);
    expect(await capsulesOf(user)).toBe(250);
    const [row] = await db.sql<{ troops_granted: string; troops_season: string }>("select troops_granted, troops_season from public.donations where user_id = $1", [user]);
    expect(Number(row!.troops_granted)).toBe(25_000);
    expect(Number(row!.troops_season)).toBe(season);
  });

  it("ne dépasse jamais la capacité : un très gros don remplit la réserve", async () => {
    const user = await player("Renfort2", 10_000, land1);
    const res = await give(user, 10_000);
    // Capacité à 1 territoire, avec ces 10 000 capsules.
    const cap = Math.floor(capacity(1, 10_000));
    expect(res.troops).toBe(cap - 10_000);
    expect(res.troops).toBeLessThan(10_000 * 100);
    expect((await playerRow(db, season, user))!.troops).toBe(cap);
    // Un second don ne donne plus rien, mais il compte toujours.
    const full = await give(user, 1);
    expect(await capsulesOf(user)).toBe(10_001);
    expect(full.troops).toBeLessThan(100);
    expect((await feed())[0]).toMatchObject({ kind: "donation", capsules: 1 });
  });

  it("calcule comme l'écran", async () => {
    const [row] = await db.sql<{ v: string }>("select internal.donation_troops(250, 10000, 183255.4, $1::jsonb) v", [JSON.stringify(DEFAULT_CONFIG)]);
    expect(Number(row!.v)).toBe(donationTroops(250, 10_000, 183_255.4));
    const [full] = await db.sql<{ v: string }>("select internal.donation_troops(5000, 180000, 183255.4, $1::jsonb) v", [JSON.stringify(DEFAULT_CONFIG)]);
    expect(Number(full!.v)).toBe(donationTroops(5000, 180_000, 183_255.4));
    expect(Number(full!.v)).toBe(3255);
  });

  it("suit le réglage de la saison", async () => {
    const config = clone();
    config.troopsPerCapsule = 10;
    season = (await openSeason(db, config)).id;
    const user = await player("Renfort3", 10_000, land1);
    expect(await give(user, 250)).toMatchObject({ troops: 2500 });
  });

  it("rien pour un don refusé, et rien tant qu'il n'est pas validé", async () => {
    const user = await player("Renfort4", 10_000, land1);
    const { id } = await declare(user, 250);
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
    await db.rpc(asUser(officer), "review_donation", { p_donation: id, p_approve: false, p_reason: "Introuvable" });
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
    expect((await feed()).filter((e) => e.kind === "donation")).toEqual([]);
  });

  it("un don saisi par un officier donne les mêmes troupes, pas un total de départ", async () => {
    const user = await player("Renfort5", 10_000, land1);
    const enter = (kind: string, capsules: number) =>
      db.rpc<{ ok: boolean; troops: number }>(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: user, p_capsules: capsules, p_donated_on: today(), p_kind: kind });
    expect(await enter("donation", 100)).toMatchObject({ ok: true, troops: 10_000 });
    expect(await enter("opening", 5000)).toMatchObject({ ok: true, troops: 0 });
    expect((await playerRow(db, season, user))!.troops).toBe(20_000);
    expect(await capsulesOf(user)).toBe(5100);
  });

  it("un don d'avant la saison n'augmente que la capacité", async () => {
    const user = await player("Renfort6", 10_000, land1);
    const res = await approve((await declare(user, 500, "2020-01-01").catch(() => ({ id: 0 }))).id || (await db.rpc<{ id: number }>(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: user, p_capsules: 500, p_donated_on: "2020-01-01" })).id).catch(() => ({ troops: 0 }));
    expect(res.troops ?? 0).toBe(0);
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
    expect(await capsulesOf(user)).toBe(500);
  });

  it("un donneur anonyme le reste dans le fil", async () => {
    const hidden = await player("Discret", 10_000, land1);
    const shown = await player("Visible", 10_000, land2);
    await db.rpc(asUser(shown), "set_donation_anonymity", { p_anonymous: false });
    await give(hidden, 10);
    await give(shown, 20);
    const gifts = (await feed()).filter((e) => e.kind === "donation");
    expect(gifts.find((e) => e.capsules === 10)).toMatchObject({ actor: null, sent: 1000 });
    expect(gifts.find((e) => e.capsules === 20)).toMatchObject({ actor: "Visible", sent: 2000 });
    expect(JSON.stringify(gifts)).not.toContain("Discret");
  });

  it("un don annulé reprend ses troupes, sans jamais passer sous zéro", async () => {
    const user = await player("Renfort7", 10_000, land1);
    const { id } = await declare(user, 100);
    await approve(id);
    expect((await playerRow(db, season, user))!.troops).toBe(20_000);
    expect(await db.rpc(asUser(officer), "cancel_donation", { p_donation: id, p_reason: "Erreur de saisie" })).toMatchObject({ ok: true, troops_taken: 10_000 });
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
    expect(await capsulesOf(user)).toBe(0);

    // Les troupes ont déjà été dépensées : la réserve s'arrête à zéro.
    const second = await declare(user, 100);
    await approve(second.id);
    await db.sql("update public.players set troops = 4000 where season_id = $1 and user_id = $2", [season, user]);
    expect(await db.rpc(asUser(officer), "cancel_donation", { p_donation: second.id, p_reason: "Erreur" })).toMatchObject({ troops_taken: 4000 });
    expect((await playerRow(db, season, user))!.troops).toBe(0);
    expect((await feed())[0]).toMatchObject({ kind: "donation_cancelled", sent: 4000 });
  });

  it("un joueur exclu ne reçoit rien", async () => {
    const user = await player("Renfort8", 10_000, land1);
    await db.sql("update public.players set excluded_at = now() where season_id = $1 and user_id = $2", [season, user]);
    expect(await give(user, 100)).toMatchObject({ ok: true, troops: 0 });
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
  });

  it("qui n'est pas encore entré dans la saison retrouve ses dons à son arrivée", async () => {
    const user = await db.addMember("Retardataire");
    expect(await give(user, 200)).toMatchObject({ ok: true, troops: 0 });
    const expected = startingTroops(200) + 20_000;
    expect(await db.rpc(asUser(user), "get_my_game")).toMatchObject({ in_game: false, start_troops: expected });
    expect(await chooseStart(db, user, land1, 1000)).toMatchObject({ ok: true, troops: expected - 1000 });
    // Le suivant passe par le renfort.
    expect(await give(user, 10)).toMatchObject({ troops: 1000 });
  });

  it("le don d'avant le lancement, même le jour même, ne compte pas dans la réserve de départ", async () => {
    await db.sql("update public.seasons set status = 'closed', closed_at = now() where status <> 'closed'");
    const user = await db.addMember("Prévoyant");
    const admin = await db.addMember("AdminRenforts", "admin");
    const { id } = await declare(user, 200);
    await approve(id);
    const created = await db.rpc<{ id: number }>(asUser(admin), "create_season", { p_name: "Après", p_config: DEFAULT_CONFIG });
    await db.rpc(asUser(admin), "start_season", { p_season: created.id });
    expect(await db.rpc(asUser(user), "get_my_game")).toMatchObject({ in_game: false, start_troops: startingTroops(200) });
  });

  it("deux dons et une action en même temps : aucune troupe perdue ni créée", async () => {
    const user = await player("Renfort9", 50_000, land1);
    const [a, b] = await Promise.all([declare(user, 30), declare(user, 70)]);
    const results = await Promise.all([approve(a.id), approve(b.id), reinforce(db, user, land1, 1000)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await playerRow(db, season, user))!.troops).toBe(50_000 + 3000 + 7000 - 1000);
  });
});

describe("le pouls de la partie", () => {
  it("change à chaque mouvement, et seulement alors", async () => {
    season = (await openSeason(db)).id;
    const user = await player("Pouls", 50_000, land1);
    const before = await pulse();
    expect(await pulse()).toBe(before);

    await reinforce(db, user, land1, 100);
    const afterReinforce = await pulse();
    expect(afterReinforce).not.toBe(before);

    await give(user, 10);
    const afterGift = await pulse();
    expect(afterGift).not.toBe(afterReinforce);

    await db.sql("update public.seasons set status = 'closed', closed_at = now() where status <> 'closed'");
    expect(await pulse()).not.toBe(afterGift);
  });

  it("répond aussi aux visiteurs, sans rien montrer d'un compte", async () => {
    const res = await db.rpc<Record<string, unknown>>(ANON, "get_game_pulse");
    expect(Object.keys(res).sort()).toEqual(["ok", "read_at", "revision"]);
  });
});

describe("la lecture chez OpenFront, le jour où elle est permise", () => {
  /** Chaque test part d'une base sans lecture, avec un membre lié à un identifiant connu. */
  const linked = async (name: string, publicId: string) => {
    const user = await db.addMember(name);
    await db.sql("update public.private_links set openfront_hash = $2 where user_id = $1", [user, hash(publicId)]);
    return user;
  };
  const ingest = (rows: unknown[]) => db.rpc<{ ok: boolean; new: number; known: number; error?: string }>(SERVICE, "ingest_openfront_donations", { p_rows: rows });
  const row = (id: string, publicId: string | null, capsules: number, at = new Date().toISOString()) => ({ id, hash: publicId === null ? null : hash(publicId), capsules, at });

  beforeEach(async () => {
    await db.sql("delete from public.openfront_donations where true");
    await db.sql("delete from public.app_state where key = 'donations_sync'");
    season = (await openSeason(db)).id;
  });

  it("est réservée à la clé de service", async () => {
    await expect(db.rpc(ANON, "ingest_openfront_donations", { p_rows: [] })).rejects.toMatchObject({ code: "42501" });
    const user = await db.addMember("Pirate");
    await expect(db.rpc(asUser(user), "ingest_openfront_donations", { p_rows: [] })).rejects.toMatchObject({ code: "42501" });
    await expect(db.sql("set role anon; select * from public.openfront_donations").finally(() => db.sql("reset role"))).rejects.toMatchObject({ code: "42501" });
  });

  it("une réponse vide n'éteint pas les déclarations", async () => {
    expect(await ingest([])).toMatchObject({ ok: true, new: 0 });
    const user = await db.addMember("ToujoursDéclarant");
    expect(await declare(user, 10)).toMatchObject({ ok: true });
  });

  it("donne les capsules et les troupes tout de suite, sans jamais compter deux fois", async () => {
    const user = await linked("Lecteur1", "PUB-L1");
    await enlist(db, season, user, 10_000);
    await place(db, season, user, land1, 1000);
    expect(await ingest([row("101", "PUB-L1", 250)])).toMatchObject({ ok: true, new: 1, known: 0 });
    expect(await capsulesOf(user)).toBe(250);
    expect((await playerRow(db, season, user))!.troops).toBe(35_000);

    // Relire le même don n'ajoute rien.
    expect(await ingest([row("101", "PUB-L1", 250), row("102", "PUB-L1", 10)])).toMatchObject({ new: 1, known: 1 });
    expect(await capsulesOf(user)).toBe(260);
    expect((await playerRow(db, season, user))!.troops).toBe(36_000);
  });

  it("un don sans compte validé attend dans le grand livre, sans nom ni identifiant", async () => {
    await ingest([row("201", "PUB-L2", 40), row("202", null, 5)]);
    const stored = await db.sql<Record<string, unknown>>("select * from public.openfront_donations order by ledger_id");
    expect(stored).toHaveLength(2);
    expect(JSON.stringify(stored)).not.toContain("PUB-L2");
    expect(Object.keys(stored[0]!).sort()).toEqual(["capsules", "donated_at", "donation_id", "donor_hash", "ledger_id", "read_at"]);

    // Il se fait valider : ses dons lui reviennent.
    const user = await db.addUser("Lecteur2");
    await db.sql("insert into public.clan_roster (public_id_hash, username, game_role) values ($1, 'Lecteur2', 'member') on conflict do nothing", [hash("PUB-L2")]);
    await db.rpc(asUser(user), "request_membership", { p_claim: "PUB-L2" });
    const [request] = await db.sql<{ id: string }>("select id from public.membership_requests where user_id = $1", [user]);
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: request!.id, p_approve: true })).toMatchObject({ ok: true });
    expect(await capsulesOf(user)).toBe(40);
  });

  it("une ligne invalide n'écrit rien du tout", async () => {
    const user = await linked("Lecteur3", "PUB-L3");
    await expect(ingest([row("301", "PUB-L3", 10), row("pas-un-nombre", "PUB-L3", 10)])).rejects.toBeTruthy();
    await expect(ingest([{ id: "302", hash: "pas-une-empreinte", capsules: 10, at: new Date().toISOString() }])).rejects.toBeTruthy();
    await expect(ingest([row("303", "PUB-L3", 0)])).rejects.toBeTruthy();
    expect(await capsulesOf(user)).toBe(0);
    expect(await db.sql("select 1 from public.openfront_donations")).toEqual([]);
    // Et les déclarations restent ouvertes, puisque rien n'a été lu.
    expect(await declare(user, 1)).toMatchObject({ ok: true });
  });

  it("la première lecture remplace ce qui a été déclaré à la main, sans double compte", async () => {
    const user = await linked("Lecteur4", "PUB-L4");
    await enlist(db, season, user, 10_000);
    await place(db, season, user, land1, 1000);
    // À la main : 100 capsules validées, 50 encore en attente. Le renfort a déjà eu lieu.
    await give(user, 100);
    const pending = await declare(user, 50);
    expect((await playerRow(db, season, user))!.troops).toBe(20_000);
    const past = new Date(Date.now() - 3_600_000).toISOString();

    // Le grand livre contient ces mêmes dons, et un nouveau.
    expect(await ingest([row("401", "PUB-L4", 100, past), row("402", "PUB-L4", 50, past)])).toMatchObject({ ok: true, new: 2 });
    expect(await capsulesOf(user)).toBe(150);
    // Lus pour la première fois : ils comptent au total, sans redonner de troupes.
    expect((await playerRow(db, season, user))!.troops).toBe(20_000);
    const rows = await db.sql<{ status: string; n: string }>("select status, count(*) n from public.donations where user_id = $1 group by status order by status", [user]);
    expect(rows.map((r) => [r.status, Number(r.n)])).toEqual([["approved", 2], ["cancelled", 1], ["superseded", 1]]);
    expect((await db.sql<{ status: string }>("select status from public.donations where id = $1", [pending.id]))[0]!.status).toBe("cancelled");

    // Les suivants donnent des troupes, et plus personne ne déclare ni ne saisit.
    await ingest([row("403", "PUB-L4", 10)]);
    expect((await playerRow(db, season, user))!.troops).toBe(21_000);
    expect(await declare(user, 5)).toMatchObject({ ok: false, error: "donations_synced" });
    expect(await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: user, p_capsules: 5, p_donated_on: today() })).toMatchObject({ ok: false, error: "donations_synced" });
    expect((await db.rpc<{ sync: { read_at: string } | null }>(ANON, "get_donor_ranking")).sync?.read_at).toBeTruthy();
    expect(await db.rpc(asUser(user), "get_my_donations")).toMatchObject({ synced: true });
  });

  it("effacer son compte coupe le lien avec le grand livre", async () => {
    const user = await linked("Lecteur5", "PUB-L5");
    await ingest([row("501", "PUB-L5", 10)]);
    expect(await db.rpc(asUser(user), "delete_my_account")).toMatchObject({ ok: true });
    expect(await db.sql<{ donor_hash: string | null }>("select donor_hash from public.openfront_donations where ledger_id = '501'")).toEqual([{ donor_hash: null }]);
  });
});
