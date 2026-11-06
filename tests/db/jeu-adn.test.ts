/**
 * L'or, les bâtiments, les bombes, les alliances et la victoire, sur un vrai Postgres.
 * Ce sont les mécaniques d'OpenFront, réécrites pour un jeu par saisons.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEFAULT_CONFIG, buildingCost, defenceFactor, resolveAttack, troopsToWin, type BuildingKind } from "../../src/lib/conquete/rules";
import { ANON, TestDb, asUser, withRole, type RpcResult } from "../support/database";
import { MAP, plainsCluster } from "../support/game";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
});
afterAll(() => db.close());

const CLUSTER = plainsCluster(8);
const [HOME, FRONT, THEIRS, FAR, A, B, C, D] = CLUSTER as [number, number, number, number, number, number, number, number];

let seasonId = 0;

/** Une saison neuve, en guerre, avec les réglages demandés. */
async function newSeason(change: (c: typeof DEFAULT_CONFIG) => void = () => {}): Promise<number> {
  await db.sql("update public.seasons set status = 'closed', closed_at = now() where status in ('draft', 'expansion', 'war')");
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
  config.limits.attackCooldownMinutes = 0;
  config.limits.protectionHours = 0;
  config.limits.attacksPerDay = 1000;
  change(config);
  const [row] = await db.sql<{ id: string }>(
    "insert into public.seasons (name, status, map_version, config, started_at, war_started_at) values ('Essai', 'war', 'v1', $1, now(), now()) returning id",
    [JSON.stringify(config)],
  );
  seasonId = Number(row!.id);
  return seasonId;
}

/** Un joueur déjà installé sur ces terres, avec de quoi agir. */
async function player(name: string, lands: number[], gold = 1_000_000, garrison = 1000): Promise<{ id: string; number: number }> {
  const id = await db.addMember(name);
  await db.sql("insert into public.players (season_id, user_id, troops, troops_at, counters_day, gold) values ($1, $2, 500000, now(), current_date, $3)", [seasonId, id, gold]);
  for (const land of lands) {
    await db.sql("insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at) values ($1, $2, $3, $4, now())", [seasonId, land, id, garrison]);
  }
  const [row] = await db.sql<{ gaul_number: number }>("select gaul_number from public.profiles where user_id = $1", [id]);
  return { id, number: row!.gaul_number };
}

const build = (id: string, territory: number, kind: string) => db.rpc(asUser(id), "build", { p_request_id: randomUUID(), p_territory: territory, p_kind: kind });
const bomb = (id: string, territory: number) => db.rpc(asUser(id), "launch_bomb", { p_request_id: randomUUID(), p_territory: territory });
const attack = (id: string, territory: number, troops: number) => db.rpc<RpcResult & { won: boolean; garrison_after: number }>(asUser(id), "attack", { p_request_id: randomUUID(), p_territory: territory, p_troops: troops });
const mine = (id: string) => db.rpc<RpcResult & { gold: number; gold_per_hour: number; capacity: number; alliance_requests: { number: number; name: string }[]; alliance_sent: number[]; traitor_until: string | null }>(asUser(id), "get_my_game");
const landOf = async (territory: number) => (await db.sql<{ garrison: string; building: string | null }>("select garrison, building from public.territory_state where season_id = $1 and territory_id = $2", [seasonId, territory]))[0]!;
const eventsOf = (kind: string) => db.sql("select * from public.game_events where season_id = $1 and kind = $2", [seasonId, kind]);

describe("l'or", () => {
  it("rapporte par terre et par heure, et se relit sans action", async () => {
    await newSeason();
    const p = await player("Rentier", [HOME, FRONT], 0);
    expect(await mine(p.id)).toMatchObject({ gold: 0, gold_per_hour: 2 * DEFAULT_CONFIG.gold.perTerritoryPerHour });
    await db.sql("update public.players set gold_at = now() - interval '3 hours 10 minutes' where user_id = $1", [p.id]);
    expect((await mine(p.id)).gold).toBe(3 * 2 * DEFAULT_CONFIG.gold.perTerritoryPerHour);
  });

  it("n'est compté qu'une fois, même relu plusieurs fois avant une dépense", async () => {
    await newSeason();
    const p = await player("Comptable", [HOME], 0);
    await db.sql("update public.players set gold_at = now() - interval '200 hours' where user_id = $1", [p.id]);
    expect(await build(p.id, HOME, "post")).toMatchObject({ ok: true, cost: DEFAULT_CONFIG.structures.postCost, gold: 200 * DEFAULT_CONFIG.gold.perTerritoryPerHour - DEFAULT_CONFIG.structures.postCost });
    expect((await mine(p.id)).gold).toBe(200 * DEFAULT_CONFIG.gold.perTerritoryPerHour - DEFAULT_CONFIG.structures.postCost);
  });

  it("offre l'or de départ à celui qui choisit sa première terre", async () => {
    await newSeason();
    const id = await db.addMember("Nouveau");
    expect(await db.rpc(asUser(id), "choose_start", { p_request_id: randomUUID(), p_territory: HOME, p_garrison: 100 })).toMatchObject({ ok: true });
    expect((await mine(id)).gold).toBe(DEFAULT_CONFIG.gold.start);
  });
});

describe("les bâtiments", () => {
  it("se paient en or, un seul par terre, et seulement chez soi", async () => {
    await newSeason();
    const p = await player("Bâtisseur", [HOME, FRONT], 12_000);
    const other = await player("Voisin", [THEIRS]);
    expect(await build(p.id, THEIRS, "city")).toMatchObject({ ok: false, error: "not_your_territory" });
    expect(await build(p.id, HOME, "chateau")).toMatchObject({ ok: false, error: "invalid_building" });
    expect(await build(p.id, HOME, "city")).toMatchObject({ ok: true, gold: 2000 });
    expect(await build(p.id, HOME, "port")).toMatchObject({ ok: false, error: "building_exists" });
    expect(await build(p.id, FRONT, "silo")).toMatchObject({ ok: false, error: "not_enough_gold", detail: { cost: DEFAULT_CONFIG.structures.siloCost, available: 2000 } });
    expect((await landOf(HOME)).building).toBe("city");
    expect(await eventsOf("building")).toHaveLength(1);
    expect(other.number).toBeGreaterThan(0);
  });

  it("coûtent le double à chaque fois, jusqu'au plafond, comme l'annonce l'écran", async () => {
    await newSeason((c) => {
      c.structures.maxCostDoublings = 2;
    });
    const p = await player("Empire", [A, B, C, D]);
    const expected = [1, 2, 4, 4].map((times) => times * DEFAULT_CONFIG.structures.cityCost);
    const lands = [A, B, C, D];
    for (let i = 0; i < 4; i++) {
      const config = { ...DEFAULT_CONFIG, structures: { ...DEFAULT_CONFIG.structures, maxCostDoublings: 2 } };
      expect(buildingCost("city", i, config)).toBe(expected[i]);
      expect(await build(p.id, lands[i]!, "city")).toMatchObject({ ok: true, cost: expected[i] });
    }
  });

  it("la ville augmente la capacité", async () => {
    await newSeason();
    const p = await player("Urbain", [HOME]);
    const before = (await mine(p.id)).capacity;
    await build(p.id, HOME, "city");
    expect((await mine(p.id)).capacity).toBe(before + DEFAULT_CONFIG.structures.cityCapacity);
  });

  it("le port rapporte, et commerce avec les ports des autres", async () => {
    await newSeason();
    const { perTerritoryPerHour } = DEFAULT_CONFIG.gold;
    const { portGoldPerHour, tradeGoldPerPort } = DEFAULT_CONFIG.structures;
    const p = await player("Armateur", [HOME]);
    const other = await player("Marchand", [THEIRS]);
    await build(p.id, HOME, "port");
    expect((await mine(p.id)).gold_per_hour).toBe(perTerritoryPerHour + portGoldPerHour);
    await build(other.id, THEIRS, "port");
    expect((await mine(p.id)).gold_per_hour).toBe(perTerritoryPerHour + portGoldPerHour + tradeGoldPerPort);
  });

  it("change de main avec la terre", async () => {
    await newSeason();
    const owner = await player("Ancien", [FRONT, FAR], 1_000_000, 100);
    const taker = await player("Preneur", [HOME]);
    await build(owner.id, FRONT, "city");
    expect(await attack(taker.id, FRONT, 200_000)).toMatchObject({ ok: true, won: true });
    expect((await landOf(FRONT)).building).toBe("city");
    const taken = (await mine(taker.id)).capacity;
    await db.sql("update public.territory_state set building = null where season_id = $1 and territory_id = $2", [seasonId, FRONT]);
    expect((await mine(taker.id)).capacity).toBe(taken - DEFAULT_CONFIG.structures.cityCapacity);
  });
});

describe("le poste de défense", () => {
  const terrainOf = (id: number) => MAP.territories[id - 1]!.terrain;

  it("alourdit les pertes de l'attaquant, sur sa terre et chez ses voisines, comme l'annonce l'écran", async () => {
    await newSeason();
    const defender = await player("Fortifié", [FRONT, THEIRS], 1_000_000, 5000);
    const attacker = await player("Assaillant", [HOME]);
    await build(defender.id, THEIRS, "post");
    expect(MAP.territories[FRONT - 1]!.neighbours).toContain(THEIRS);
    const factor = defenceFactor(true, false);
    const need = troopsToWin(5000, terrainOf(FRONT), DEFAULT_CONFIG, factor);
    expect(need).toBeGreaterThan(troopsToWin(5000, terrainOf(FRONT)));
    expect(await attack(attacker.id, FRONT, need - 1)).toMatchObject({ ok: true, won: false, garrison_after: resolveAttack(need - 1, 5000, terrainOf(FRONT), DEFAULT_CONFIG, factor).garrisonAfter });
  });

  it("gagne juste au bon chiffre, quand le poste protège la terre", async () => {
    await newSeason();
    const defender = await player("Fortifié2", [FRONT, THEIRS], 1_000_000, 5000);
    const attacker = await player("Assaillant2", [HOME]);
    await build(defender.id, FRONT, "post");
    const factor = defenceFactor(true, false);
    const need = troopsToWin(5000, terrainOf(FRONT), DEFAULT_CONFIG, factor);
    expect(await attack(attacker.id, FRONT, need)).toMatchObject({ ok: true, won: true, garrison_after: resolveAttack(need, 5000, terrainOf(FRONT), DEFAULT_CONFIG, factor).garrisonAfter });
  });
});

describe("la bombe", () => {
  it("demande un silo, de l'or et la guerre, puis détruit le bâtiment et décime la garnison", async () => {
    await newSeason();
    const shooter = await player("Artilleur", [HOME, FRONT], 100_000);
    const target = await player("Cible", [FAR], 100_000, 10_000);
    expect(await bomb(shooter.id, FAR)).toMatchObject({ ok: false, error: "no_silo" });
    await build(shooter.id, HOME, "silo");
    await build(target.id, FAR, "city");
    expect(await bomb(shooter.id, HOME)).toMatchObject({ ok: false, error: "own_territory" });
    expect(await bomb(shooter.id, D)).toMatchObject({ ok: false, error: "territory_free" });
    expect(await bomb(shooter.id, FAR)).toMatchObject({ ok: true, intercepted: false, garrison_after: 2500, gold: 100_000 - DEFAULT_CONFIG.structures.siloCost - DEFAULT_CONFIG.structures.bombCost });
    expect(await landOf(FAR)).toMatchObject({ garrison: "2500", building: null });
    expect(await eventsOf("bomb")).toHaveLength(1);
  });

  it("recharge, et ne se relance pas deux fois sur un double envoi", async () => {
    await newSeason();
    const shooter = await player("Artilleur2", [HOME], 200_000);
    await player("Cible2", [FAR, D], 0, 10_000);
    await build(shooter.id, HOME, "silo");
    const request = randomUUID();
    const first = await db.rpc(asUser(shooter.id), "launch_bomb", { p_request_id: request, p_territory: FAR });
    expect(await db.rpc(asUser(shooter.id), "launch_bomb", { p_request_id: request, p_territory: FAR })).toEqual(first);
    expect((await landOf(FAR)).garrison).toBe("2500");
    expect(await bomb(shooter.id, D)).toMatchObject({ ok: false, error: "bomb_cooldown" });
    await db.sql("update public.players set last_bomb_at = now() - interval '25 hours' where user_id = $1", [shooter.id]);
    expect(await bomb(shooter.id, D)).toMatchObject({ ok: true });
  });

  it("une défense antiaérienne l'arrête, sur la terre et chez ses voisines : l'or est perdu", async () => {
    await newSeason();
    const shooter = await player("Artilleur3", [HOME], 200_000);
    const target = await player("Protégé", [FRONT, THEIRS], 100_000, 10_000);
    await build(shooter.id, HOME, "silo");
    await build(target.id, THEIRS, "sam");
    expect(await bomb(shooter.id, FRONT)).toMatchObject({ ok: true, intercepted: true, garrison_after: 10_000 });
    expect((await landOf(FRONT)).garrison).toBe("10000");
    expect(await eventsOf("bomb_intercepted")).toHaveLength(1);
    expect((await mine(shooter.id)).gold).toBe(200_000 - DEFAULT_CONFIG.structures.siloCost - DEFAULT_CONFIG.structures.bombCost);
  });

  it("respecte la protection d'une terre, et ne vise pas un allié", async () => {
    await newSeason();
    const shooter = await player("Artilleur4", [HOME], 200_000);
    const target = await player("Abrité", [FAR], 0, 10_000);
    await build(shooter.id, HOME, "silo");
    await db.sql("update public.territory_state set protected_until = now() + interval '1 hour' where season_id = $1 and territory_id = $2", [seasonId, FAR]);
    expect(await bomb(shooter.id, FAR)).toMatchObject({ ok: false, error: "territory_protected" });
    await db.sql("update public.territory_state set protected_until = null where season_id = $1 and territory_id = $2", [seasonId, FAR]);
    await db.rpc(asUser(shooter.id), "propose_alliance", { p_number: target.number });
    await db.rpc(asUser(target.id), "propose_alliance", { p_number: (await db.sql<{ gaul_number: number }>("select gaul_number from public.profiles where user_id = $1", [shooter.id]))[0]!.gaul_number });
    expect(await bomb(shooter.id, FAR)).toMatchObject({ ok: false, error: "ally" });
  });

  it("n'existe pas avant la guerre", async () => {
    await newSeason();
    const shooter = await player("Pressé", [HOME], 200_000);
    const target = await player("Tranquille", [FAR]);
    await build(shooter.id, HOME, "silo");
    await db.sql("update public.seasons set status = 'expansion' where id = $1", [seasonId]);
    expect(await bomb(shooter.id, FAR)).toMatchObject({ ok: false, error: "not_war" });
    expect(target.number).toBeGreaterThan(0);
  });
});

describe("les alliances", () => {
  const propose = (id: string, number: number) => db.rpc<RpcResult & { status: string }>(asUser(id), "propose_alliance", { p_number: number });

  it("il faut être deux : une demande attend, l'autre répond en proposant à son tour", async () => {
    await newSeason();
    const a = await player("Alpha", [HOME]);
    const b = await player("Bravo", [FRONT]);
    expect(await propose(a.id, b.number)).toMatchObject({ ok: true, status: "pending" });
    expect(await propose(a.id, b.number)).toMatchObject({ ok: false, error: "alliance_pending" });
    expect(await mine(a.id)).toMatchObject({ alliance_sent: [b.number], alliance_requests: [] });
    expect(await mine(b.id)).toMatchObject({ alliance_requests: [{ number: a.number, name: "Alpha" }], alliance_sent: [] });
    const state = await db.rpc<{ alliances: unknown[] }>(ANON, "get_game_state");
    expect(state.alliances).toEqual([]);
    expect(await propose(b.id, a.number)).toMatchObject({ ok: true, status: "active" });
    const after = await db.rpc<{ alliances: { a: number; b: number }[] }>(ANON, "get_game_state");
    expect(after.alliances).toHaveLength(1);
    expect(await propose(a.id, b.number)).toMatchObject({ ok: false, error: "already_allied" });
    expect(await eventsOf("alliance_made")).toHaveLength(1);
  });

  it("empêche d'attaquer son allié", async () => {
    await newSeason();
    const a = await player("Charlie", [HOME]);
    const b = await player("Delta", [FRONT]);
    await propose(a.id, b.number);
    await propose(b.id, a.number);
    expect(await attack(a.id, FRONT, 100_000)).toMatchObject({ ok: false, error: "ally" });
  });

  it("trahir rend attaquable, et le traître coûte moitié moins, aux yeux de tous", async () => {
    await newSeason();
    const a = await player("Echo", [HOME, FAR], 0, 5000);
    const b = await player("Foxtrot", [FRONT], 0, 5000);
    const c = await player("Golf", [THEIRS]);
    await propose(a.id, b.number);
    await propose(b.id, a.number);
    expect(await db.rpc(asUser(c.id), "break_alliance", { p_number: a.number })).toMatchObject({ ok: false, error: "not_allied" });
    const broken = await db.rpc<RpcResult & { traitor_until: string }>(asUser(a.id), "break_alliance", { p_number: b.number });
    expect(broken.ok).toBe(true);
    expect((await mine(a.id)).traitor_until).toBeTruthy();
    const state = await db.rpc<{ players: { number: number; traitor_until: string | null }[]; alliances: unknown[] }>(ANON, "get_game_state");
    expect(state.alliances).toEqual([]);
    expect(state.players.find((p) => p.number === a.number)?.traitor_until).toBeTruthy();
    expect(state.players.find((p) => p.number === b.number)?.traitor_until).toBeNull();
    expect(await eventsOf("alliance_broken")).toHaveLength(1);

    // Le traître défend moins bien : il faut nettement moins de troupes.
    const terrain = MAP.territories[HOME - 1]!.terrain;
    const factor = defenceFactor(false, true);
    const need = troopsToWin(5000, terrain, DEFAULT_CONFIG, factor);
    expect(need).toBeLessThan(troopsToWin(5000, terrain));
    expect(await attack(b.id, HOME, need)).toMatchObject({ ok: true, won: true });

    // La trahison passe : il redevient un joueur comme les autres.
    await db.sql("update public.players set traitor_until = now() - interval '1 minute' where user_id = $1", [a.id]);
    const later = await db.rpc<{ players: { number: number; traitor_until: string | null }[] }>(ANON, "get_game_state");
    expect(later.players.find((p) => p.number === a.number)?.traitor_until).toBeNull();
  });

  it("expire seule, sans trahison, et se reconclut", async () => {
    await newSeason();
    const a = await player("Hotel", [HOME]);
    const b = await player("India", [FRONT], 0, 100);
    await propose(a.id, b.number);
    await propose(b.id, a.number);
    await db.sql("update public.alliances set expires_at = now() - interval '1 minute' where season_id = $1", [seasonId]);
    expect((await db.rpc<{ alliances: unknown[] }>(ANON, "get_game_state")).alliances).toEqual([]);
    expect((await mine(a.id)).traitor_until).toBeNull();
    expect(await propose(a.id, b.number)).toMatchObject({ ok: true, status: "pending" });
    expect(await propose(b.id, a.number)).toMatchObject({ ok: true, status: "active" });
  });

  it("une demande se refuse, ou se retire", async () => {
    await newSeason();
    const a = await player("Juliet", [HOME]);
    const b = await player("Kilo", [FRONT]);
    await propose(a.id, b.number);
    expect(await db.rpc(asUser(b.id), "refuse_alliance", { p_number: a.number })).toMatchObject({ ok: true });
    expect((await mine(b.id)).alliance_requests).toEqual([]);
    expect(await db.rpc(asUser(b.id), "refuse_alliance", { p_number: a.number })).toMatchObject({ ok: false, error: "no_alliance_request" });
    // Personne ne rompt une alliance conclue en la « refusant » : ce serait trahir sans en payer le prix.
    await propose(a.id, b.number);
    await propose(b.id, a.number);
    expect(await db.rpc(asUser(a.id), "refuse_alliance", { p_number: b.number })).toMatchObject({ ok: false, error: "no_alliance_request" });
  });

  it("refuse un inconnu et soi-même, et ferme la porte aux visiteurs", async () => {
    await newSeason();
    const a = await player("Lima", [HOME]);
    expect(await propose(a.id, a.number)).toMatchObject({ ok: false, error: "not_on_yourself" });
    expect(await propose(a.id, 999_999)).toMatchObject({ ok: false, error: "player_not_found" });
    await expect(db.rpc(ANON, "propose_alliance", { p_number: a.number })).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(ANON, "build", { p_request_id: randomUUID(), p_territory: HOME, p_kind: "city" })).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(ANON, "launch_bomb", { p_request_id: randomUUID(), p_territory: HOME })).rejects.toMatchObject({ code: "42501" });
    await expect(withRole(db.pool, ANON, (c) => c.query("select * from public.alliances"))).rejects.toMatchObject({ code: "42501" });
    await expect(withRole(db.pool, asUser(a.id), (c) => c.query("select * from public.alliances"))).rejects.toMatchObject({ code: "42501" });
    await expect(withRole(db.pool, asUser(a.id), (c) => c.query("update public.players set gold = 999999999 where user_id = $1", [a.id]))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("la victoire", () => {
  it("à la part de carte voulue, la saison se termine et le vainqueur est annoncé", async () => {
    const total = MAP.territories.length;
    await newSeason((c) => {
      c.victoryShare = 3 / total;
    });
    const winner = await player("Conquérant", [HOME, FRONT], 0, 1000);
    await player("Vaincu", [THEIRS, FAR], 0, 10);
    expect(await attack(winner.id, THEIRS, 100_000)).toMatchObject({ ok: true, won: true });
    const [season] = await db.sql<{ status: string; final_standings: unknown[] }>("select status, final_standings from public.seasons where id = $1", [seasonId]);
    expect(season!.status).toBe("closed");
    expect(season!.final_standings.length).toBe(2);
    expect(await eventsOf("victory")).toHaveLength(1);
    expect(await eventsOf("season_closed")).toHaveLength(1);
    expect((await db.rpc<{ season: unknown }>(ANON, "get_game_state")).season).toBeNull();
  });

  it("en dessous, la partie continue", async () => {
    await newSeason();
    const p = await player("Modeste", [HOME, FRONT], 0, 1000);
    await player("Autre", [THEIRS, FAR], 0, 10);
    expect(await attack(p.id, THEIRS, 100_000)).toMatchObject({ ok: true, won: true });
    const [season] = await db.sql<{ status: string }>("select status from public.seasons where id = $1", [seasonId]);
    expect(season!.status).toBe("war");
  });
});

describe("le calcul du prix et l'écran", () => {
  it("s'accordent pour tous les bâtiments", async () => {
    const config = JSON.stringify(DEFAULT_CONFIG);
    for (const kind of ["city", "port", "post", "sam", "silo"] as BuildingKind[]) {
      for (const owned of [0, 1, 2, 3, 4, 5, 9]) {
        const [row] = await db.sql<{ v: string }>("select internal.building_cost($1, $2, $3::jsonb) as v", [kind, owned, config]);
        expect(Number(row!.v), `${kind} ${owned}`).toBe(buildingCost(kind, owned));
      }
    }
  });
});
