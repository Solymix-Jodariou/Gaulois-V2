import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { ANON, TestDb, asUser } from "../support/database";
import { enlist, openSeason, place, playerRow, plainsCluster } from "../support/game";

// Tout est fictif : les vraies réponses ne sont visibles que des membres et n'entrent pas dans ce dépôt.
let db: TestDb;
let officer: string;
let admin: string;
let season: number;
const [land] = plainsCluster(1) as [number];

const hash = (id: string) => createHash("sha256").update(id).digest("hex");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const row = (id: string, publicId: string | null, capsules: number, at = ago(HOUR)) => ({ id, hash: publicId === null ? null : hash(publicId), capsules, at });

interface ImportResult {
  ok: boolean;
  new: number;
  known: number;
  first_read: boolean;
  ledger: number;
  error?: string;
  detail?: Record<string, unknown>;
}
const send = (user: string, rows: unknown, expected: number | null = null, first = false) =>
  db.rpc<ImportResult>(asUser(user), "import_openfront_donations", { p_rows: rows, p_expected: expected, p_first_read: first });
/** La première lecture, faite comme il faut. */
const firstRead = (rows: { id: string }[]) => send(admin, rows, rows.length, true);

const linked = async (name: string, publicId: string) => {
  const user = await db.addMember(name);
  await db.sql("update public.private_links set openfront_hash = $2 where user_id = $1", [user, hash(publicId)]);
  return user;
};
const capsulesOf = async (user: string) => Number((await db.sql<{ c: string }>("select capsules_total c from public.profiles where user_id = $1", [user]))[0]!.c);
const ledgerSize = async () => Number((await db.sql<{ n: string }>("select count(*) n from public.openfront_donations"))[0]!.n);
const synced = async () => (await db.sql("select 1 from public.app_state where key = 'donations_sync'")).length > 0;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());

beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  officer = await db.addMember("OfficierCopie", "officer");
  admin = await db.addMember("AdminCopie", "admin");
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.sql("delete from public.openfront_donations where true");
  await db.sql("delete from public.app_state where key = 'donations_sync'");
  season = (await openSeason(db)).id;
});

describe("qui peut importer", () => {
  it("un visiteur est refusé par la base, un simple membre par la fonction", async () => {
    await expect(db.rpc(ANON, "import_openfront_donations", { p_rows: [] })).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(ANON, "get_donation_import_state")).rejects.toMatchObject({ code: "42501" });
    const member = await db.addMember("PirateCopie");
    expect(await send(member, [row("1", "PUB-X", 10)], 1, true)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(member), "get_donation_import_state")).toMatchObject({ ok: false, error: "forbidden" });
    expect(await ledgerSize()).toBe(0);
  });

  it("un officier ne fait pas la première lecture, mais les suivantes", async () => {
    expect(await send(officer, [row("1", "PUB-X", 10)], 1, true)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await synced()).toBe(false);
    expect(await firstRead([row("1", "PUB-X", 10)])).toMatchObject({ ok: true, first_read: true });
    expect(await send(officer, [row("2", "PUB-X", 10)])).toMatchObject({ ok: true, first_read: false, new: 1 });
  });
});

describe("la première lecture", () => {
  it("demande une confirmation et la liste complète, et sinon ne change rien", async () => {
    const user = await linked("CopieAttente", "PUB-A");
    const rows = [row("1", "PUB-A", 10), row("2", "PUB-A", 20)];
    expect(await send(admin, rows, 2, false)).toMatchObject({ ok: false, error: "first_read_unconfirmed" });
    expect(await send(admin, rows, 3, true)).toMatchObject({ ok: false, error: "first_read_incomplete", detail: { received: 2, expected: 3 } });
    expect(await send(admin, rows, null, true)).toMatchObject({ ok: false, error: "first_read_incomplete" });
    // Un don en double ne compte qu'une fois pour dire que la liste est complète.
    expect(await send(admin, [rows[0], rows[0]], 2, true)).toMatchObject({ ok: false, error: "first_read_incomplete" });
    expect(await synced()).toBe(false);
    expect(await ledgerSize()).toBe(0);
    expect(await capsulesOf(user)).toBe(0);
    expect(await db.rpc(asUser(user), "declare_donation", { p_request_id: randomUUID(), p_capsules: 1, p_donated_on: today() })).toMatchObject({ ok: true });
  });

  it("remplace ce qui a été validé à la main, sans double compte ni troupes en plus", async () => {
    const user = await linked("CopieMain", "PUB-B");
    await enlist(db, season, user, 10_000);
    await place(db, season, user, land, 1000);
    const validated = await db.rpc<{ id: number }>(asUser(user), "declare_donation", { p_request_id: randomUUID(), p_capsules: 100, p_donated_on: today() });
    await db.rpc(asUser(officer), "review_donation", { p_donation: validated.id, p_approve: true });
    const waiting = await db.rpc<{ id: number }>(asUser(user), "declare_donation", { p_request_id: randomUUID(), p_capsules: 50, p_donated_on: today() });
    expect((await playerRow(db, season, user))!.troops).toBe(20_000);

    expect(await firstRead([row("10", "PUB-B", 100), row("11", "PUB-B", 50), row("12", null, 7), row("13", "PUB-INCONNU", 9)])).toEqual({ ok: true, new: 4, known: 0, first_read: true, ledger: 4 });
    expect(await capsulesOf(user)).toBe(150);
    expect((await playerRow(db, season, user))!.troops).toBe(20_000);

    const old = await db.sql<{ id: string; status: string; reason: string }>("select id, status, reason from public.donations where id = any($1::bigint[]) order by id", [[validated.id, waiting.id]]);
    expect(old.map((d) => d.status)).toEqual(["superseded", "cancelled"]);
    expect(old[0]!.reason).toBe("Remplacé par la lecture de la liste des dons d'OpenFront.");

    expect(await db.rpc(asUser(user), "declare_donation", { p_request_id: randomUUID(), p_capsules: 5, p_donated_on: today() })).toMatchObject({ ok: false, error: "donations_synced" });
    expect(await db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: user, p_capsules: 5, p_donated_on: today() })).toMatchObject({ ok: false, error: "donations_synced" });
  });

  it("un don fait entre la copie et l'envoi n'est pas perdu : il donne ses troupes à la lecture suivante", async () => {
    const user = await linked("CopieEntreDeux", "PUB-C");
    await enlist(db, season, user, 10_000);
    await place(db, season, user, land, 1000);
    // La saison a commencé avant ces dons : sinon, ils ne donneraient de toute façon aucune troupe.
    await db.sql("update public.seasons set started_at = now() - interval '2 hours' where id = $1", [season]);
    const copiedAt = ago(30 * 60_000);
    const between = ago(10 * 60_000);
    await firstRead([row("20", "PUB-C", 100, copiedAt)]);
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
    const [state] = await db.sql<{ since: string }>("select value ->> 'since' as since from public.app_state where key = 'donations_sync'");
    expect(Date.parse(state!.since)).toBe(Date.parse(copiedAt) + 1);

    expect(await send(officer, [row("21", "PUB-C", 10, between), row("20", "PUB-C", 100, copiedAt)])).toMatchObject({ ok: true, new: 1, known: 1 });
    expect(await capsulesOf(user)).toBe(110);
    expect((await playerRow(db, season, user))!.troops).toBe(11_000);
  });
});

describe("les lectures suivantes", () => {
  it("acceptent une copie partielle, et recoller un don n'ajoute rien", async () => {
    const user = await linked("CopieSuite", "PUB-D");
    await enlist(db, season, user, 10_000);
    await place(db, season, user, land, 1000);
    await firstRead([row("30", "PUB-D", 100)]);

    const fresh = [row("31", "PUB-D", 250, new Date().toISOString())];
    expect(await send(officer, fresh)).toEqual({ ok: true, new: 1, known: 0, first_read: false, ledger: 2 });
    expect(await capsulesOf(user)).toBe(350);
    expect((await playerRow(db, season, user))!.troops).toBe(35_000);

    expect(await send(officer, fresh)).toEqual({ ok: true, new: 0, known: 1, first_read: false, ledger: 2 });
    expect(await capsulesOf(user)).toBe(350);
    expect((await playerRow(db, season, user))!.troops).toBe(35_000);
  });

  it("un don oublié à la première lecture revient au total, sans donner de troupes", async () => {
    const user = await linked("CopieOubli", "PUB-E");
    await enlist(db, season, user, 10_000);
    await place(db, season, user, land, 1000);
    await firstRead([row("40", "PUB-E", 100, ago(HOUR))]);
    expect(await send(officer, [row("39", "PUB-E", 60, ago(2 * HOUR))])).toMatchObject({ ok: true, new: 1 });
    expect(await capsulesOf(user)).toBe(160);
    expect((await playerRow(db, season, user))!.troops).toBe(10_000);
  });

  it("un don d'un joueur sans compte attend, et lui revient à sa validation", async () => {
    await firstRead([row("50", "PUB-F", 40)]);
    const user = await db.addUser("CopieArrivant");
    await db.sql("insert into public.clan_roster (public_id_hash, username, game_role) values ($1, 'CopieArrivant', 'member') on conflict do nothing", [hash("PUB-F")]);
    await db.rpc(asUser(user), "request_membership", { p_claim: "PUB-F" });
    const [request] = await db.sql<{ id: string }>("select id from public.membership_requests where user_id = $1", [user]);
    expect(await db.rpc(asUser(officer), "review_membership", { p_request: request!.id, p_approve: true })).toMatchObject({ ok: true });
    expect(await capsulesOf(user)).toBe(40);
  });
});

describe("ce que le serveur refuse", () => {
  it.each([
    ["pas une liste", { id: "1" }],
    ["une liste vide", []],
    ["autre chose qu'un don", ["bonjour"]],
    ["un identifiant de don illisible", [row("pas-un-nombre", "PUB-G", 10)]],
    ["une empreinte illisible", [{ ...row("1", null, 10), hash: "PUB-EN-CLAIR" }]],
    ["aucun montant", [{ id: "1", hash: null, at: ago(HOUR) }]],
    ["un montant nul", [row("1", "PUB-G", 0)]],
    ["un montant à virgule", [row("1", "PUB-G", 1.5)]],
    ["un montant que la table refuserait", [row("1", "PUB-G", 1_000_000_001)]],
    ["aucune date", [{ id: "1", hash: null, capsules: 10 }]],
    ["une date qui n'existe pas", [row("1", "PUB-G", 10, "2026-13-45T10:00:00.000Z")]],
    ["une date en toutes lettres", [row("1", "PUB-G", 10, "infinity")]],
    ["un don venu du futur", [row("1", "PUB-G", 10, new Date(Date.now() + 2 * HOUR).toISOString())]],
  ])("%s, sans rien écrire même à côté d'un don valable", async (_label, rows) => {
    const withGood = Array.isArray(rows) && rows.length > 0 ? [row("99", "PUB-G", 10), ...rows] : rows;
    expect(await send(admin, withGood, 99, true)).toMatchObject({ ok: false, error: "invalid_donations" });
    expect(await synced()).toBe(false);
    expect(await ledgerSize()).toBe(0);
  });

  it("une liste trop longue d'un coup", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => row(String(i + 1), null, 1));
    expect(await send(admin, rows, 2001, true)).toMatchObject({ ok: false, error: "too_many_donations", detail: { limit: 2000 } });
    expect(await ledgerSize()).toBe(0);
  });
});

describe("ce qui reste", () => {
  it("le journal garde qui a importé quoi", async () => {
    await firstRead([row("60", "PUB-H", 10), row("61", "PUB-H", 10)]);
    await send(officer, [row("61", "PUB-H", 10), row("62", "PUB-H", 10)]);
    const log = await db.sql<{ actor_id: string; details: Record<string, unknown> }>("select actor_id, details from public.admin_log where action = 'donations_imported' order by id desc limit 2");
    expect(log).toEqual([
      { actor_id: officer, details: { new: 1, known: 1, first_read: false } },
      { actor_id: admin, details: { new: 2, known: 0, first_read: true } },
    ]);
  });

  it("un officier voit où en est la liste", async () => {
    const read = () => db.rpc<{ synced: boolean; known: number; read_at: string | null; newest_at: string | null }>(asUser(officer), "get_donation_import_state");
    expect(await read()).toMatchObject({ ok: true, synced: false, known: 0, read_at: null, newest_at: null });
    const newest = ago(HOUR);
    await firstRead([row("70", "PUB-I", 10, ago(2 * HOUR)), row("71", "PUB-I", 10, newest)]);
    const state = await read();
    expect(state).toMatchObject({ synced: true, known: 2 });
    expect(Date.parse(state.newest_at!)).toBe(Date.parse(newest));
    expect(state.read_at).toBeTruthy();
  });

  it("rien d'autre qu'une empreinte du donneur n'est gardé", async () => {
    await firstRead([row("80", "PUB-SECRET", 10)]);
    const stored = await db.sql<Record<string, unknown>>("select * from public.openfront_donations");
    expect(JSON.stringify(stored)).not.toContain("PUB-SECRET");
    expect(stored[0]!["donor_hash"]).toBe(hash("PUB-SECRET"));
  });
});
