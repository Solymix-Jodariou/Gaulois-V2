/**
 * Les actions simultanées, sur de vraies connexions à un vrai Postgres.
 * Chaque appel tourne dans sa propre transaction, comme deux joueurs qui cliquent en même temps.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { TestDb, asUser, type RpcResult } from "../support/database";
import { MAP, attack, chooseStart, clone, enlist, expand, openSeason, place, playerRow, plainsCluster, reinforce, rid, stateRow } from "../support/game";

let db: TestDb;
let season: number;
let admin: string;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
});
afterAll(() => db.close());

/** Une saison sans recharge ni limite du jour, pour que seule la simultanéité soit à l'épreuve. */
const looseConfig = () => {
  const config = clone();
  config.limits.attackCooldownMinutes = 0;
  config.limits.attacksPerDay = 1000;
  config.limits.expansionsPerDay = 1000;
  config.limits.actionsPerMinute = 600;
  return config;
};

beforeEach(async () => {
  ({ id: season, admin } = await openSeason(db, looseConfig()));
});

const startWar = () => db.rpc(asUser(admin), "set_war_date", { p_season: season, p_at: new Date(Date.now() - 1000).toISOString() });

const invariants = async () => {
  const [row] = await db.sql<{ negative_troops: string; bad_garrison: string }>(`
    select
      (select count(*) from public.players where troops < 0) as negative_troops,
      (select count(*) from public.territory_state where garrison < 1) as bad_garrison`);
  expect(Number(row!.negative_troops)).toBe(0);
  expect(Number(row!.bad_garrison)).toBe(0);
};

describe("la même terre libre, plusieurs joueurs au même instant", () => {
  it("un seul l'obtient comme départ, les autres sont prévenus, personne ne perd de troupes", async () => {
    const target = plainsCluster(1)[0]!;
    const members = await Promise.all(Array.from({ length: 12 }, (_, i) => db.addMember(`Course${i}`)));
    const results = await Promise.all(members.map((m) => chooseStart(db, m, target, 1000)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.error === "territory_taken")).toHaveLength(11);
    expect(await db.sql("select 1 from public.territory_state where season_id = $1", [season])).toHaveLength(1);
    await invariants();
  });

  it("un seul la conquiert quand elle est voisine de plusieurs joueurs", async () => {
    const target = MAP.territories.find((t) => t.neighbours.length >= 5 && t.terrain === "plains")!;
    const starts = target.neighbours.slice(0, 5);
    const members = await Promise.all(starts.map((_, i) => db.addMember(`Voisin${i}`)));
    await Promise.all(members.map((m, i) => chooseStart(db, m, starts[i]!, 1000)));
    const results = await Promise.all(members.map((m) => expand(db, m, target.id, 5000)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.error === "territory_taken")).toHaveLength(4);
    for (const [i, member] of members.entries()) {
      expect((await playerRow(db, season, member))!.troops, `joueur ${i}`).toBe(results[i]!.ok ? 19_000 : 24_000);
    }
    await invariants();
  });
});

describe("plusieurs attaques au même instant sur le même territoire", () => {
  it("s'exécutent l'une après l'autre : une seule prise, la protection arrête les suivantes", async () => {
    await startWar();
    const target = MAP.territories.find((t) => t.neighbours.length >= 6)!;
    const defender = await db.addMember("Defenseur");
    const backup = MAP.territories.find((t) => !target.neighbours.includes(t.id) && t.id !== target.id)!.id;
    await enlist(db, season, defender, 1000);
    await place(db, season, defender, target.id, 1000);
    await place(db, season, defender, backup, 1000);

    const attackers = await Promise.all(target.neighbours.slice(0, 6).map((_, i) => db.addMember(`Assaut${i}`)));
    for (const [i, member] of attackers.entries()) {
      await enlist(db, season, member, 50_000);
      await place(db, season, member, target.neighbours[i]!, 100);
    }

    const results = await Promise.all(attackers.map((m) => attack(db, m, target.id, 40_000)));
    const won = results.filter((r) => r.ok && r.won);
    expect(won).toHaveLength(1);
    expect(results.filter((r) => r.error === "territory_protected")).toHaveLength(5);

    const winner = attackers[results.findIndex((r) => r.won)]!;
    expect(await stateRow(db, season, target.id)).toMatchObject({ owner_id: winner });
    for (const member of attackers) {
      expect((await playerRow(db, season, member))!.troops).toBe(member === winner ? 10_000 : 50_000);
    }
    const events = await db.sql("select 1 from public.game_events where season_id = $1 and kind = 'attack_won'", [season]);
    expect(events).toHaveLength(1);
    await invariants();
  });

  it("sans protection, chaque attaque part du résultat de la précédente : les comptes tombent juste", async () => {
    const config = looseConfig();
    config.limits.protectionHours = 0;
    ({ id: season, admin } = await openSeason(db, config));
    await startWar();
    const target = MAP.territories.find((t) => t.neighbours.length >= 6)!;
    const defender = await db.addMember("Defenseur2");
    const backup = MAP.territories.find((t) => !target.neighbours.includes(t.id) && t.id !== target.id)!.id;
    await enlist(db, season, defender, 1000);
    await place(db, season, defender, target.id, 200_000);
    await place(db, season, defender, backup, 1000);

    const attackers = await Promise.all(target.neighbours.slice(0, 6).map((_, i) => db.addMember(`Vague${i}`)));
    for (const [i, member] of attackers.entries()) {
      await enlist(db, season, member, 30_000);
      await place(db, season, member, target.neighbours[i]!, 100);
    }
    const results = await Promise.all(attackers.map((m) => attack(db, m, target.id, 30_000)));
    expect(results.every((r) => r.ok)).toBe(true);
    // Chaque combat a vu la garnison laissée par le précédent : le journal forme une chaîne sans trou.
    const events = await db.sql<{ garrison_before: string; garrison_after: string }>(
      "select garrison_before, garrison_after from public.game_events where season_id = $1 and kind like 'attack%' order by id",
      [season],
    );
    expect(events).toHaveLength(6);
    expect(Number(events[0]!.garrison_before)).toBe(200_000);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.garrison_before).toBe(events[i - 1]!.garrison_after);
    }
    await invariants();
  });
});

describe("un même joueur qui clique partout", () => {
  it("ne dépense jamais plus que sa réserve, même avec 20 attaques au même instant", async () => {
    await startWar();
    const cluster = plainsCluster(30);
    const player = await db.addMember("Frenetique");
    const victim = await db.addMember("Victime");
    await enlist(db, season, player, 1000);
    await enlist(db, season, victim, 1000);
    await place(db, season, player, cluster[0]!, 10);
    const targets = MAP.territories[cluster[0]! - 1]!.neighbours;
    for (const id of targets) await place(db, season, victim, id, 1_000_000);

    // La réserve permet 4 envois de 250 : on en tente 20.
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => attack(db, player, targets[i % targets.length]!, 250)));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.filter((r) => r.error === "not_enough_troops")).toHaveLength(16);
    expect((await playerRow(db, season, player))!.troops).toBe(0);
    await invariants();
  });

  it("une réserve partagée entre renfort et attaque ne descend jamais sous zéro", async () => {
    await startWar();
    const player = await db.addMember("Partage");
    const victim = await db.addMember("Victime2");
    const home = plainsCluster(1)[0]!;
    const targets = MAP.territories[home - 1]!.neighbours;
    await enlist(db, season, player, 1000);
    await enlist(db, season, victim, 1000);
    await place(db, season, player, home, 10);
    for (const id of targets) await place(db, season, victim, id, 1_000_000);

    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? reinforce(db, player, home, 200) : attack(db, player, targets[0]!, 200))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await playerRow(db, season, player))!.troops).toBe(0);
    await invariants();
  });
});

describe("une même demande envoyée plusieurs fois", () => {
  it("n'agit qu'une fois, et chaque envoi reçoit la même réponse", async () => {
    await startWar();
    const player = await db.addMember("Double");
    const victim = await db.addMember("VictimeDouble");
    const home = plainsCluster(1)[0]!;
    const [target, backup] = MAP.territories[home - 1]!.neighbours as [number, number];
    await enlist(db, season, player, 100_000);
    await enlist(db, season, victim, 1000);
    await place(db, season, player, home, 10);
    await place(db, season, victim, target, 1000);
    await place(db, season, victim, backup, 1000);

    const request = rid();
    const send = () => db.rpc<RpcResult & { won: boolean }>(asUser(player), "attack", { p_request_id: request, p_territory: target, p_troops: 10_000 });
    const results = await Promise.all(Array.from({ length: 10 }, send));
    expect(results.every((r) => r.ok && r.won)).toBe(true);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect((await playerRow(db, season, player))!.troops).toBe(90_000);
    expect(await db.sql("select 1 from public.game_events where season_id = $1 and kind = 'attack_won'", [season])).toHaveLength(1);
  });

  it("l'identifiant de demande d'un autre joueur ne donne pas accès à sa réponse", async () => {
    const a = await db.addMember("DemandeA");
    const b = await db.addMember("DemandeB");
    const [first, second] = plainsCluster(2) as [number, number];
    const request = rid();
    await db.rpc(asUser(a), "choose_start", { p_request_id: request, p_territory: first, p_garrison: 100 });
    expect(await db.rpc(asUser(b), "choose_start", { p_request_id: request, p_territory: second, p_garrison: 100 })).toMatchObject({ ok: false, error: "invalid_request" });
  });
});

describe("une clôture de saison pendant les attaques", () => {
  it("attend la fin de l'action en cours : la carte figée reste cohérente", async () => {
    await startWar();
    const player = await db.addMember("DernierAssaut");
    const victim = await db.addMember("DerniereCible");
    const home = plainsCluster(1)[0]!;
    const targets = MAP.territories[home - 1]!.neighbours;
    await enlist(db, season, player, 500_000);
    await enlist(db, season, victim, 1000);
    await place(db, season, player, home, 10);
    for (const id of targets) await place(db, season, victim, id, 500);

    const actions = [
      ...targets.slice(0, 4).map((t) => attack(db, player, t, 20_000)),
      db.rpc(asUser(admin), "close_season", { p_season: season }),
      ...targets.slice(0, 2).map((t) => attack(db, player, t, 20_000)),
    ];
    await Promise.all(actions);

    const [row] = await db.sql<{ status: string; final_map: { id: number; owner: number; garrison: number }[] }>("select status, final_map from public.seasons where id = $1", [season]);
    expect(row!.status).toBe("closed");
    const live = await db.sql<{ territory_id: number; garrison: string }>("select territory_id, garrison from public.territory_state where season_id = $1 order by territory_id", [season]);
    expect(row!.final_map.map((t) => t.id).sort((a, b) => a - b)).toEqual(live.map((t) => t.territory_id));
    await invariants();
  });
});
