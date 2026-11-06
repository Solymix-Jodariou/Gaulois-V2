/**
 * Ce qu'un parcours réel de joueurs a révélé, le 6 novembre 2026, et qu'aucun test ne regardait :
 * ce qui devait prévenir les joueurs, et ce qu'une bombe faisait perdre au défenseur.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { capacity, settle, DEFAULT_CONFIG } from "../../src/lib/conquete/rules";
import { ANON, SERVICE, TestDb, asUser, type RpcResult } from "../support/database";
import { MAP, plainsCluster } from "../support/game";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
});
afterAll(() => db.close());

const [HOME, FRONT, THEIRS, FAR] = plainsCluster(8) as [number, number, number, number];
let seasonId = 0;

async function newSeason(change: (c: typeof DEFAULT_CONFIG) => void = () => {}): Promise<number> {
  await db.sql("update public.seasons set status = 'closed', closed_at = now() where status in ('draft', 'expansion', 'war')");
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
  config.limits.attackCooldownMinutes = 0;
  config.limits.protectionHours = 0;
  change(config);
  const [row] = await db.sql<{ id: string }>("insert into public.seasons (name, status, map_version, config, started_at, war_started_at) values ('Audit', 'war', 'v1', $1, now(), now()) returning id", [JSON.stringify(config)]);
  seasonId = Number(row!.id);
  return seasonId;
}

async function player(name: string, lands: number[], gold = 1_000_000, garrison = 1000): Promise<{ id: string; number: number }> {
  const id = await db.addMember(name);
  await db.sql("insert into public.players (season_id, user_id, troops, troops_at, counters_day, gold) values ($1, $2, 500000, now(), current_date, $3)", [seasonId, id, gold]);
  for (const land of lands) await db.sql("insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at) values ($1, $2, $3, $4, now())", [seasonId, land, id, garrison]);
  const [row] = await db.sql<{ gaul_number: number }>("select gaul_number from public.profiles where user_id = $1", [id]);
  return { id, number: row!.gaul_number };
}

const pulse = async () => (await db.rpc<{ revision: string }>(ANON, "get_game_pulse")).revision;
const attack = (id: string, territory: number, troops: number) => db.rpc<RpcResult & { won: boolean }>(asUser(id), "attack", { p_request_id: randomUUID(), p_territory: territory, p_troops: troops });
const build = (id: string, territory: number, kind: string) => db.rpc(asUser(id), "build", { p_request_id: randomUUID(), p_territory: territory, p_kind: kind });
const bomb = (id: string, territory: number) => db.rpc<RpcResult>(asUser(id), "launch_bomb", { p_request_id: randomUUID(), p_territory: territory });
const toAnnounce = async () => (await db.rpc<RpcResult & { rows: { kind: string; actor: string | null; target: string | null }[] }>(SERVICE, "list_events_to_notify", { p_limit: 100 })).rows;

describe("une alliance proposée arrive sans attendre", () => {
  it("le pouls de la partie change quand on la propose, puis quand on la refuse", async () => {
    await newSeason();
    const a = await player("Proposeur", [HOME]);
    const b = await player("Destinataire", [THEIRS]);
    const before = await pulse();
    expect(await db.rpc(asUser(a.id), "propose_alliance", { p_number: b.number })).toMatchObject({ ok: true, status: "pending" });
    const proposed = await pulse();
    expect(proposed, "sinon l'autre joueur l'attend 5 minutes").not.toBe(before);
    expect(await db.rpc(asUser(b.id), "refuse_alliance", { p_number: a.number })).toMatchObject({ ok: true });
    expect(await pulse()).not.toBe(proposed);
  });

  it("et quand elle est conclue", async () => {
    await newSeason();
    const a = await player("Proposeur 2", [HOME]);
    const b = await player("Destinataire 2", [THEIRS]);
    await db.rpc(asUser(a.id), "propose_alliance", { p_number: b.number });
    const proposed = await pulse();
    await db.rpc(asUser(b.id), "propose_alliance", { p_number: a.number });
    expect(await pulse()).not.toBe(proposed);
  });
});

describe("le fil dit qui est concerné", () => {
  it("par numéro public, pour prévenir le joueur attaqué", async () => {
    await newSeason();
    const a = await player("Assaillant", [HOME, FRONT]);
    const b = await player("Assailli", [THEIRS, FAR], 0, 10);
    expect(await attack(a.id, THEIRS, 100_000)).toMatchObject({ ok: true, won: true });
    const { rows } = await db.rpc<{ rows: { kind: string; actor_number: number; target_number: number }[] }>(ANON, "get_feed");
    expect(rows[0]).toMatchObject({ kind: "attack_won", actor_number: a.number, target_number: b.number });
  });

  it("sans jamais trahir un donneur anonyme", async () => {
    await newSeason();
    const donor = await player("Donneur discret", [HOME]);
    await db.sql("insert into public.game_events (season_id, kind, actor_id, sent, capsules) values ($1, 'donation', $2, 100, 1)", [seasonId, donor.id]);
    const { rows } = await db.rpc<{ rows: { actor: string | null; actor_number: number | null }[] }>(ANON, "get_feed");
    expect(rows[0]).toMatchObject({ actor: null, actor_number: null });
    await db.sql("update public.profiles set anonymous_donations = false where user_id = $1", [donor.id]);
    expect((await db.rpc<{ rows: { actor: string; actor_number: number }[] }>(ANON, "get_feed")).rows[0]).toMatchObject({ actor: "Donneur discret", actor_number: donor.number });
  });
});

describe("les annonces sur Discord", () => {
  it("couvrent ce que le texte sait annoncer : bombe, trahison, victoire", async () => {
    const total = MAP.territories.length;
    await newSeason((c) => {
      c.victoryShare = 3 / total;
    });
    await db.sql("update public.game_events set notified_at = now() where notified_at is null");
    const a = await player("Bombardier", [HOME, FRONT]);
    const b = await player("Bombardé", [THEIRS, FAR], 0, 10);
    await build(a.id, HOME, "silo");
    expect(await bomb(a.id, FAR)).toMatchObject({ ok: true, intercepted: false });
    await db.rpc(asUser(a.id), "propose_alliance", { p_number: b.number });
    await db.rpc(asUser(b.id), "propose_alliance", { p_number: a.number });
    await db.rpc(asUser(a.id), "break_alliance", { p_number: b.number });
    expect(await attack(a.id, THEIRS, 100_000)).toMatchObject({ won: true });
    const kinds = (await toAnnounce()).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["bomb", "alliance_broken", "attack_won", "victory", "season_closed"]));
    // Rien de banal : construire ou s'allier ne s'annonce pas.
    expect(kinds).not.toContain("building");
    expect(kinds).not.toContain("alliance_made");
  });
});

describe("une bombe", () => {
  it("laisse au défenseur ce que son port lui devait jusque-là", async () => {
    await newSeason();
    const { perTerritoryPerHour } = DEFAULT_CONFIG.gold;
    const { portGoldPerHour } = DEFAULT_CONFIG.structures;
    const shooter = await player("Tireur", [HOME]);
    const target = await player("Armateur visé", [FAR], 8000);
    await build(target.id, FAR, "port");
    await build(shooter.id, HOME, "silo");
    await db.sql("update public.players set gold_at = now() - interval '3 hours 5 minutes' where season_id = $1 and user_id = $2", [seasonId, target.id]);
    expect(await bomb(shooter.id, FAR)).toMatchObject({ ok: true, intercepted: false });
    const expected = 3 * (perTerritoryPerHour + portGoldPerHour);
    expect((await db.rpc<{ gold: number; gold_per_hour: number }>(asUser(target.id), "get_my_game")).gold).toBe(expected);
  });
});

describe("la fin de saison", () => {
  it("nomme le vainqueur dans l'historique", async () => {
    const total = MAP.territories.length;
    await newSeason((c) => {
      c.victoryShare = 3 / total;
    });
    const winner = await player("Grand Vainqueur", [HOME, FRONT]);
    await player("Grand Vaincu", [THEIRS, FAR], 0, 10);
    expect(await attack(winner.id, THEIRS, 100_000)).toMatchObject({ won: true });
    const { rows } = await db.rpc<{ rows: { id: number; winner: string | null }[] }>(ANON, "get_season_history");
    expect(rows[0]).toMatchObject({ id: seasonId, winner: "Grand Vainqueur" });
  });

  it("ne nomme personne quand un admin clôture sans vainqueur", async () => {
    await newSeason();
    await player("Simple joueur", [HOME]);
    const admin = await db.addMember(`Admin${randomUUID().slice(0, 6)}`, "admin");
    expect(await db.rpc(asUser(admin), "close_season", { p_season: seasonId })).toMatchObject({ ok: true });
    const { rows } = await db.rpc<{ rows: { id: number; winner: string | null }[] }>(ANON, "get_season_history");
    expect(rows[0]).toMatchObject({ id: seasonId, winner: null });
  });
});

describe("le temps qui passe", () => {
  it("la réserve affichée suit la formule de l'écran, villes comprises", async () => {
    await newSeason();
    const p = await player("Bâtisseur", [HOME, FRONT, THEIRS]);
    await build(p.id, HOME, "city");
    await db.sql("update public.players set troops = 40000, troops_at = now() - interval '3 hours 5 minutes' where season_id = $1 and user_id = $2", [seasonId, p.id]);
    const cap = capacity(3, 0) + DEFAULT_CONFIG.structures.cityCapacity;
    const mine = await db.rpc<{ troops: number; capacity: number }>(asUser(p.id), "get_my_game");
    expect(mine.capacity).toBe(Math.floor(cap));
    expect(mine.troops).toBe(settle(40_000, 3 * 3_600_000 + 300_000, cap).troops);
  });
});
