import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { resolveAttack } from "../../src/lib/conquete/rules";
import { TestDb, asUser, type RpcResult } from "../support/database";
import { MAP, attack, enlist, neighbourOf, openSeason, place, playerRow, plainsCluster, seasonStatus, stateRow } from "../support/game";

let db: TestDb;
let season: number;
let admin: string;
let home: number;
let target: number;
let extra: number;
let attacker: string;
let defender: string;

beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  const cluster = plainsCluster(6);
  home = cluster[0]!;
  target = neighbourOf(home, "plains");
  extra = cluster.find((id) => id !== home && id !== target)!;
});
afterAll(() => db.close());

/** Une guerre en cours : l'attaquant tient `home`, le défenseur tient `target` et une autre terre. */
beforeEach(async () => {
  ({ id: season, admin } = await openSeason(db));
  await db.rpc(asUser(admin), "set_war_date", { p_season: season, p_at: new Date(Date.now() - 1000).toISOString() });
  expect(await seasonStatus(db, season)).toBe("war");
  attacker = await db.addMember(`Att${season}`);
  defender = await db.addMember(`Def${season}`);
  await enlist(db, season, attacker, 100_000);
  await enlist(db, season, defender, 50_000);
  await place(db, season, attacker, home, 1000);
  await place(db, season, defender, target, 10_000);
  await place(db, season, defender, extra, 500);
});

describe("la résolution d'un combat", () => {
  it("victoire : les survivants tiennent le territoire, l'ancienne garnison disparaît", async () => {
    const res = await attack(db, attacker, target, 15_000);
    expect(res).toMatchObject({ ok: true, won: true, garrison_before: 10_000, garrison_after: 2131, losses: 12_869, troops: 85_000 });
    expect(await stateRow(db, season, target)).toMatchObject({ owner_id: attacker, garrison: 2131 });
    expect(await playerRow(db, season, attacker)).toMatchObject({ captured: 1, attacks_today: 1 });
    expect(await playerRow(db, season, defender)).toMatchObject({ lost: 1 });
  });

  it("échec : tous les envoyés sont perdus et la garnison est entamée", async () => {
    const res = await attack(db, attacker, target, 12_000);
    expect(res).toMatchObject({ ok: true, won: false, garrison_after: 2540, losses: 12_000, troops: 88_000 });
    expect(await stateRow(db, season, target)).toMatchObject({ owner_id: defender, garrison: 2540 });
    expect(await playerRow(db, season, attacker)).toMatchObject({ captured: 0, attacks_today: 1 });
  });

  it("le serveur et l'aperçu à l'écran donnent le même résultat", async () => {
    const preview = resolveAttack(15_000, 10_000, "plains");
    const res = await attack(db, attacker, target, 15_000);
    expect(res.won).toBe(preview.won);
    expect(res.garrison_after).toBe(preview.garrisonAfter);
  });

  it("le fil raconte le combat, avec des noms et pas de chiffre inventé", async () => {
    await attack(db, attacker, target, 15_000);
    const feed = await db.rpc<RpcResult & { rows: { kind: string; actor: string; target: string; sent: number; losses: number; garrison_before: number; garrison_after: number }[] }>(asUser(attacker), "get_feed");
    expect(feed.rows[0]).toMatchObject({ kind: "attack_won", actor: `Att${season}`, target: `Def${season}`, sent: 15_000, losses: 12_869, garrison_before: 10_000, garrison_after: 2131 });
  });

  it("une prise compte au classement des conquérants", async () => {
    await attack(db, attacker, target, 15_000);
    const state = await db.rpc<RpcResult & { players: { name: string; territories: number; captured: number; lost: number }[] }>(asUser(attacker), "get_game_state");
    expect(state.players.find((p) => p.name === `Att${season}`)).toMatchObject({ territories: 2, captured: 1 });
    expect(state.players.find((p) => p.name === `Def${season}`)).toMatchObject({ territories: 1, lost: 1 });
  });
});

describe("les conditions d'une attaque", () => {
  it("impossible pendant l'expansion", async () => {
    const { id } = await openSeason(db);
    await enlist(db, id, attacker, 1000);
    await place(db, id, attacker, home, 10);
    await place(db, id, defender, target, 10);
    await place(db, id, defender, extra, 10);
    expect(await attack(db, attacker, target, 500)).toMatchObject({ ok: false, error: "not_war" });
  });

  it("seulement sur un territoire voisin, occupé, et pas le sien", async () => {
    expect(await attack(db, attacker, home, 500)).toMatchObject({ ok: false, error: "own_territory" });

    const taken = new Set([home, target, extra]);
    const free = MAP.territories[home - 1]!.neighbours.find((id) => !taken.has(id));
    if (free !== undefined) expect(await attack(db, attacker, free, 500)).toMatchObject({ ok: false, error: "territory_free" });

    const homeNeighbours = new Set(MAP.territories[home - 1]!.neighbours);
    const [farA, farB] = MAP.territories.filter((t) => !homeNeighbours.has(t.id) && !taken.has(t.id)).map((t) => t.id) as [number, number];
    const other = await db.addMember(`Loin${season}`);
    await place(db, season, other, farA, 10);
    await place(db, season, other, farB, 10);
    expect(await attack(db, attacker, farA, 500)).toMatchObject({ ok: false, error: "not_adjacent" });
  });

  it("jamais plus de troupes que la réserve, ni zéro, ni négatif", async () => {
    expect(await attack(db, attacker, target, 0)).toMatchObject({ ok: false, error: "invalid_troops" });
    expect(await attack(db, attacker, target, -5)).toMatchObject({ ok: false, error: "invalid_troops" });
    expect(await attack(db, attacker, target, 100_001)).toMatchObject({ ok: false, error: "not_enough_troops", detail: { available: 100_000 } });
    expect((await playerRow(db, season, attacker))!.troops).toBe(100_000);
    expect(await stateRow(db, season, target)).toMatchObject({ garrison: 10_000 });
  });

  it("réservé aux membres validés", async () => {
    await db.sql("update public.profiles set status = 'pending' where user_id = $1", [attacker]);
    expect(await attack(db, attacker, target, 500)).toMatchObject({ ok: false, error: "not_validated" });
  });
});

describe("les garde-fous", () => {
  it("recharge d'une heure entre deux attaques", async () => {
    const res = await attack(db, attacker, target, 500);
    expect(res).toMatchObject({ ok: true, won: false });
    const again = await attack(db, attacker, target, 500);
    expect(again).toMatchObject({ ok: false, error: "attack_cooldown" });
    expect(Date.parse((again.detail as { until: string }).until)).toBeGreaterThan(Date.now() + 3_500_000);
    await db.sql("update public.players set last_attack_at = now() - interval '61 minutes' where user_id = $1", [attacker]);
    expect(await attack(db, attacker, target, 500)).toMatchObject({ ok: true });
  });

  it("5 attaques par jour, puis plus rien jusqu'au lendemain", async () => {
    for (let i = 0; i < 5; i++) {
      await db.sql("update public.players set last_attack_at = null where user_id = $1", [attacker]);
      expect(await attack(db, attacker, target, 100)).toMatchObject({ ok: true });
    }
    await db.sql("update public.players set last_attack_at = null where user_id = $1", [attacker]);
    expect(await attack(db, attacker, target, 100)).toMatchObject({ ok: false, error: "attack_limit", detail: { limit: 5 } });
    await db.sql("update public.players set counters_day = counters_day - 1 where user_id = $1", [attacker]);
    expect(await attack(db, attacker, target, 100)).toMatchObject({ ok: true });
    expect((await playerRow(db, season, attacker))!.attacks_today).toBe(1);
  });

  it("un territoire fraîchement pris est protégé 24 h, puis attaquable", async () => {
    await attack(db, attacker, target, 15_000);
    const row = await stateRow(db, season, target);
    expect(row!.protected_until!.getTime()).toBeGreaterThan(Date.now() + 23.9 * 3_600_000);
    // Le défenseur tente de reprendre aussitôt, depuis une terre voisine. L'attaquant garde une autre terre.
    await db.sql("update public.territory_state set owner_id = $1 where season_id = $2 and territory_id = $3", [defender, season, home]);
    await place(db, season, attacker, plainsCluster(9).find((id) => ![home, target, extra].includes(id))!, 100);
    const retake = await attack(db, defender, target, 15_000);
    expect(retake).toMatchObject({ ok: false, error: "territory_protected" });
    await db.sql("update public.territory_state set protected_until = now() - interval '1 minute' where season_id = $1 and territory_id = $2", [season, target]);
    expect(await attack(db, defender, target, 15_000)).toMatchObject({ ok: true, won: true });
  });

  it("on n'attaque pas le dernier territoire d'un joueur", async () => {
    await db.sql("delete from public.territory_state where season_id = $1 and territory_id = $2", [season, extra]);
    expect(await attack(db, attacker, target, 50_000)).toMatchObject({ ok: false, error: "last_territory" });
    expect(await stateRow(db, season, target)).toMatchObject({ owner_id: defender });
  });

  it("une attaque refusée ne consomme ni troupes ni attaque du jour", async () => {
    await db.sql("update public.territory_state set protected_until = now() + interval '1 hour' where season_id = $1 and territory_id = $2", [season, target]);
    expect(await attack(db, attacker, target, 500)).toMatchObject({ ok: false, error: "territory_protected" });
    expect(await playerRow(db, season, attacker)).toMatchObject({ troops: 100_000, attacks_today: 0 });
  });
});

describe("le défenseur", () => {
  it("régénère jusqu'à l'instant de l'attaque, selon le nombre de terres qu'il tenait", async () => {
    await db.sql("update public.players set troops = 50000, troops_at = now() - interval '3 hours' where user_id = $1", [defender]);
    const before = (await playerRow(db, season, defender))!.troops;
    await attack(db, attacker, target, 15_000);
    const after = (await playerRow(db, season, defender))!.troops;
    expect(after).toBeGreaterThan(before);
  });

  it("une garnison perd une partie de ses troupes sans jamais tomber à zéro", async () => {
    await db.sql("update public.territory_state set garrison = 2 where season_id = $1 and territory_id = $2", [season, target]);
    const res = await attack(db, attacker, target, 1);
    expect(res).toMatchObject({ ok: true, won: false });
    expect((await stateRow(db, season, target))!.garrison).toBeGreaterThanOrEqual(1);
  });
});
