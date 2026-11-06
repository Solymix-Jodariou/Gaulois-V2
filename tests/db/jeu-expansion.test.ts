import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { capacity, neutralCost, startingTroops } from "../../src/lib/conquete/rules";
import { ANON, TestDb, asUser, withRole, type RpcResult } from "../support/database";
import { MAP, chooseStart, clone, expand, neighbourOf, openSeason, playerRow, plainsCluster, reinforce, rid, seasonStatus, stateRow } from "../support/game";

let db: TestDb;
let season: number;
let cluster: number[];
beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  cluster = plainsCluster(8);
});
afterAll(() => db.close());
beforeEach(async () => {
  season = (await openSeason(db)).id;
});

describe("choisir son territoire de départ", () => {
  it("place la garnison demandée, sans frais, et donne les 25 000 troupes de départ d'OpenFront", async () => {
    const member = await db.addMember("Depart1");
    const res = await chooseStart(db, member, cluster[0]!, 2000);
    expect(res).toMatchObject({ ok: true, garrison: 2000, troops: 23_000 });
    expect(startingTroops(0)).toBe(25_000);
    expect(await stateRow(db, season, cluster[0]!)).toMatchObject({ owner_id: member, garrison: 2000 });
    expect((await playerRow(db, season, member))!.troops).toBe(23_000);
  });

  it("un donneur démarre avec plus de troupes, selon la formule", async () => {
    const member = await db.addMember("Depart2");
    await db.sql("update public.profiles set capsules_total = 10000 where user_id = $1", [member]);
    expect(await chooseStart(db, member, cluster[0]!, 1000)).toMatchObject({ ok: true, troops: startingTroops(10_000) - 1000 });
    expect(startingTroops(10_000)).toBe(75_000);
  });

  it("refuse un territoire pris, inconnu, ou un second départ", async () => {
    const a = await db.addMember("Depart3");
    const b = await db.addMember("Depart4");
    await chooseStart(db, a, cluster[0]!, 1000);
    expect(await chooseStart(db, b, cluster[0]!, 1000)).toMatchObject({ ok: false, error: "territory_taken" });
    expect(await chooseStart(db, b, 99_999, 1000)).toMatchObject({ ok: false, error: "territory_not_found" });
    expect(await chooseStart(db, a, cluster[1]!, 1000)).toMatchObject({ ok: false, error: "already_started" });
  });

  it("refuse une garnison nulle, négative, ou plus grande que la réserve", async () => {
    const a = await db.addMember("Depart5");
    expect(await chooseStart(db, a, cluster[0]!, 0)).toMatchObject({ ok: false, error: "invalid_troops" });
    expect(await chooseStart(db, a, cluster[0]!, -10)).toMatchObject({ ok: false, error: "invalid_troops" });
    expect(await chooseStart(db, a, cluster[0]!, 25_001)).toMatchObject({ ok: false, error: "not_enough_troops", detail: { available: 25_000 } });
    expect(await stateRow(db, season, cluster[0]!)).toBeUndefined();
  });

  it("réservé aux membres validés, jamais aux visiteurs", async () => {
    const pending = await db.addUser("DepartAttente");
    expect(await chooseStart(db, pending, cluster[0]!, 100)).toMatchObject({ ok: false, error: "not_validated" });
    await expect(db.rpc(ANON, "choose_start", { p_request_id: rid(), p_territory: cluster[0], p_garrison: 100 })).rejects.toMatchObject({ code: "42501" });
    expect(await stateRow(db, season, cluster[0]!)).toBeUndefined();
  });
});

describe("conquérir une terre libre", () => {
  it("coûte le prix du terrain : le reste devient la garnison", async () => {
    const member = await db.addMember("Terre1");
    await chooseStart(db, member, cluster[0]!, 1000);
    const target = neighbourOf(cluster[0]!, "plains");
    const res = await expand(db, member, target, 3000);
    expect(res).toMatchObject({ ok: true, cost: 1600, garrison: 1400, troops: 21_000 });
    expect(await stateRow(db, season, target)).toMatchObject({ owner_id: member, garrison: 1400 });
  });

  it("le prix dépend du relief : 1 600, 2 000, 2 400", () => {
    expect([neutralCost("plains"), neutralCost("highland"), neutralCost("mountain")]).toEqual([1600, 2000, 2400]);
  });

  it("il faut envoyer plus que le prix du terrain", async () => {
    const member = await db.addMember("Terre2");
    await chooseStart(db, member, cluster[0]!, 1000);
    const target = neighbourOf(cluster[0]!, "plains");
    expect(await expand(db, member, target, 1600)).toMatchObject({ ok: false, error: "too_few_troops", detail: { minimum: 1601 } });
    expect(await expand(db, member, target, 1601)).toMatchObject({ ok: true, garrison: 1 });
  });

  it("seulement une terre voisine et libre", async () => {
    const a = await db.addMember("Terre3");
    const b = await db.addMember("Terre4");
    await chooseStart(db, a, cluster[0]!, 1000);
    const far = MAP.territories.find((t) => !MAP.territories[cluster[0]! - 1]!.neighbours.includes(t.id) && t.id !== cluster[0])!.id;
    expect(await expand(db, a, far, 3000)).toMatchObject({ ok: false, error: "not_adjacent" });
    const next = neighbourOf(cluster[0]!);
    await chooseStart(db, b, next, 1000);
    expect(await expand(db, a, next, 3000)).toMatchObject({ ok: false, error: "territory_taken" });
  });

  it("sans territoire de départ, on ne conquiert rien", async () => {
    const member = await db.addMember("Terre5");
    expect(await expand(db, member, cluster[0]!, 3000)).toMatchObject({ ok: false, error: "no_start" });
  });

  it("limité chaque jour pour tous, même un gros donneur, et ça repart le lendemain", async () => {
    await db.sql("update public.seasons set config = jsonb_set(config, '{limits,expansionsPerDay}', '3') where id = $1", [season]);
    const whale = await db.addMember("Terre6");
    await db.sql("update public.profiles set capsules_total = 1000000 where user_id = $1", [whale]);
    await chooseStart(db, whale, cluster[0]!, 1000);
    for (let i = 1; i <= 3; i++) expect(await expand(db, whale, cluster[i]!, 2000)).toMatchObject({ ok: true });
    expect(await expand(db, whale, cluster[4]!, 2000)).toMatchObject({ ok: false, error: "expansion_limit", detail: { limit: 3 } });
    await db.sql("update public.players set counters_day = counters_day - 1 where user_id = $1", [whale]);
    expect(await expand(db, whale, cluster[4]!, 2000)).toMatchObject({ ok: true });
    expect((await playerRow(db, season, whale))!.expansions_today).toBe(1);
  });
});

describe("renforcer", () => {
  it("déplace des troupes de la réserve vers un de ses territoires, sans frais", async () => {
    const member = await db.addMember("Renfort1");
    await chooseStart(db, member, cluster[0]!, 1000);
    expect(await reinforce(db, member, cluster[0]!, 500)).toMatchObject({ ok: true, garrison: 1500, troops: 23_500 });
  });

  it("jamais le territoire d'un autre, ni plus que la réserve", async () => {
    const a = await db.addMember("Renfort2");
    const b = await db.addMember("Renfort3");
    await chooseStart(db, a, cluster[0]!, 1000);
    await chooseStart(db, b, neighbourOf(cluster[0]!), 1000);
    expect(await reinforce(db, a, neighbourOf(cluster[0]!), 100)).toMatchObject({ ok: false, error: "not_your_territory" });
    expect(await reinforce(db, a, cluster[0]!, 24_001)).toMatchObject({ ok: false, error: "not_enough_troops" });
    expect(await reinforce(db, a, cluster[0]!, 0)).toMatchObject({ ok: false, error: "invalid_troops" });
  });
});

describe("la régénération", () => {
  it("se calcule à la demande, heure par heure, et suit la formule d'OpenFront", async () => {
    const member = await db.addMember("Regen1");
    await chooseStart(db, member, cluster[0]!, 5000);
    await db.sql("update public.players set troops = 25000, troops_at = now() - interval '24 hours 5 minutes' where user_id = $1", [member]);
    const me = await db.rpc<RpcResult & { troops: number; capacity: number; next_regen: number }>(asUser(member), "get_my_game");
    expect(me.capacity).toBe(Math.floor(capacity(1, 0)));
    // Une journée à partir de 25 000, avec 1 territoire : calcul pas à pas dans le test.
    let t = 25_000;
    for (let i = 0; i < 24; i++) t += (10 + Math.pow(t, 0.73) / 4) * (1 - t / capacity(1, 0));
    expect(me.troops).toBe(Math.floor(t));
  });

  it("rien avant la première heure pleine, et l'heure entamée n'est pas perdue", async () => {
    const member = await db.addMember("Regen2");
    await chooseStart(db, member, cluster[0]!, 5000);
    const [{ troops_at: before }] = (await db.sql<{ troops_at: Date }>("select troops_at from public.players where user_id = $1", [member])) as [{ troops_at: Date }];
    await reinforce(db, member, cluster[0]!, 1);
    const [{ troops_at: after }] = (await db.sql<{ troops_at: Date }>("select troops_at from public.players where user_id = $1", [member])) as [{ troops_at: Date }];
    expect(after.getTime()).toBe(before.getTime());
    await db.sql("update public.players set troops_at = now() - interval '90 minutes' where user_id = $1", [member]);
    const [{ troops_at: mark }] = (await db.sql<{ troops_at: Date }>("select troops_at from public.players where user_id = $1", [member])) as [{ troops_at: Date }];
    await reinforce(db, member, cluster[0]!, 1);
    const [{ troops_at: moved }] = (await db.sql<{ troops_at: Date }>("select troops_at from public.players where user_id = $1", [member])) as [{ troops_at: Date }];
    expect(moved.getTime() - mark.getTime()).toBe(3_600_000);
  });

  it("un don validé en cours de saison augmente la capacité aussitôt", async () => {
    const member = await db.addMember("Regen3");
    await chooseStart(db, member, cluster[0]!, 5000);
    const before = await db.rpc<RpcResult & { capacity: number }>(asUser(member), "get_my_game");
    await db.sql("update public.profiles set capsules_total = 10000 where user_id = $1", [member]);
    const after = await db.rpc<RpcResult & { capacity: number }>(asUser(member), "get_my_game");
    expect(after.capacity - before.capacity).toBe(200_000);
  });
});

describe("le passage à la guerre", () => {
  it("se fait dès que tous les territoires sont occupés", async () => {
    const member = await db.addMember("Plein1");
    const others = await Promise.all([db.addMember("Plein2"), db.addMember("Plein3")]);
    const ids = MAP.territories.map((t) => t.id);
    const last = ids.at(-1)!;
    await db.sql(
      "insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at) select $1, id, $2, 10, now() from public.territories where map_version = 'v1' and id <> $3",
      [season, others[0], last],
    );
    expect(await seasonStatus(db, season)).toBe("expansion");
    expect(await chooseStart(db, member, last, 100)).toMatchObject({ ok: true });
    expect(await seasonStatus(db, season)).toBe("war");
    const [event] = await db.sql<{ kind: string }>("select kind from public.game_events where season_id = $1 order by id desc limit 1", [season]);
    expect(event!.kind).toBe("war_started");
  });

  it("ou à la date fixée par un admin, dès la première action qui suit", async () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const { id } = await openSeason(db, clone(), soon);
    const member = await db.addMember("Date1");
    await chooseStart(db, member, cluster[0]!, 1000);
    expect(await seasonStatus(db, id)).toBe("expansion");
    await db.sql("update public.seasons set war_starts_at = now() - interval '1 minute' where id = $1", [id]);
    const state = await db.rpc<RpcResult & { season: { phase: string } }>(ANON, "get_game_state");
    expect(state.season.phase).toBe("war");
    await reinforce(db, member, cluster[0]!, 1);
    expect(await seasonStatus(db, id)).toBe("war");
  });

  it("une date passée ne peut pas lancer une saison, mais un admin peut déclencher la guerre", async () => {
    const { id, admin } = await openSeason(db);
    expect(await db.rpc(asUser(admin), "set_war_date", { p_season: id, p_at: new Date(Date.now() - 1000).toISOString() })).toMatchObject({ ok: true });
    expect(await seasonStatus(db, id)).toBe("war");
    expect(await db.rpc(asUser(admin), "set_war_date", { p_season: id, p_at: new Date().toISOString() })).toMatchObject({ ok: false, error: "not_expansion" });
  });
});

describe("ce que voit le public", () => {
  it("la carte, les joueurs et le fil, sans identifiant de compte", async () => {
    const member = await db.addMember("Public1");
    await chooseStart(db, member, cluster[0]!, 1000);
    await expand(db, member, neighbourOf(cluster[0]!, "plains"), 3000);
    const state = await db.rpc<RpcResult & { season: { name: string; phase: string; config: unknown }; players: { name: string; territories: number; number: number }[]; territories: { id: number; garrison: number; owner: number }[]; me: number | null; read_at: string }>(ANON, "get_game_state");
    expect(state.season).toMatchObject({ name: "Saison de test", phase: "expansion" });
    expect(state.players).toEqual([expect.objectContaining({ name: "Public1", territories: 2 })]);
    expect(state.territories).toHaveLength(2);
    expect(state.territories[0]!.owner).toBe(state.players[0]!.number);
    expect(state.me).toBeNull();
    expect(Date.parse(state.read_at)).toBeGreaterThan(0);
    expect(JSON.stringify(state)).not.toContain(member);

    const feed = await db.rpc<RpcResult & { rows: { kind: string; actor: string; territory: string }[] }>(ANON, "get_feed");
    expect(feed.rows[0]).toMatchObject({ kind: "expand", actor: "Public1" });
    expect(feed.rows[0]!.territory).toBe(MAP.territories[neighbourOf(cluster[0]!, "plains") - 1]!.name);
    expect(JSON.stringify(feed)).not.toContain(member);
  });

  it("sans saison en cours, il n'y a rien : ce n'est pas une carte vide à zéro", async () => {
    await db.sql("update public.seasons set status = 'closed'");
    const state = await db.rpc<RpcResult & { season: null }>(ANON, "get_game_state");
    expect(state.season).toBeNull();
    const member = await db.addMember("Public2");
    expect(await chooseStart(db, member, cluster[0]!, 100)).toMatchObject({ ok: false, error: "no_active_season" });
  });

  it("un joueur connecté se reconnaît, et voit où il en est", async () => {
    const member = await db.addMember("Public3");
    const before = await db.rpc<RpcResult & { in_game: boolean; start_troops: number }>(asUser(member), "get_my_game");
    expect(before).toMatchObject({ in_game: false, start_troops: 25_000 });
    await chooseStart(db, member, cluster[0]!, 1000);
    const after = await db.rpc<RpcResult & { in_game: boolean; troops: number; territories: number; expansions_today: number }>(asUser(member), "get_my_game");
    expect(after).toMatchObject({ in_game: true, troops: 24_000, territories: 1, expansions_today: 0, excluded: false });
    const state = await db.rpc<RpcResult & { me: number; players: { number: number }[] }>(asUser(member), "get_game_state");
    expect(state.me).toBe(state.players[0]!.number);
  });
});

describe("personne ne touche directement aux tables du jeu", () => {
  it("ni un membre ni un officier ne peuvent modifier une garnison ou une réserve", async () => {
    const member = await db.addMember("Triche1");
    const officer = await db.addMember("Triche2", "officer");
    await chooseStart(db, member, cluster[0]!, 1000);
    for (const who of [member, officer]) {
      for (const sql of [
        "update public.territory_state set garrison = 999999",
        `update public.players set troops = 999999 where user_id = '${member}'`,
        `insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at) values (${season}, ${cluster[1]}, '${who}', 1, now())`,
        "delete from public.territory_state",
        `update public.seasons set status = 'war' where id = ${season}`,
        `insert into public.game_events (season_id, kind) values (${season}, 'season_closed')`,
      ]) {
        await expect(withRole(db.pool, asUser(who), (c) => c.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
      }
    }
    await expect(withRole(db.pool, ANON, (c) => c.query("select * from public.players"))).rejects.toMatchObject({ code: "42501" });
    await expect(withRole(db.pool, ANON, (c) => c.query("select * from public.territory_state"))).rejects.toMatchObject({ code: "42501" });
  });

  it("un membre ne lit pas la réserve d'un autre", async () => {
    const a = await db.addMember("Secret1");
    const b = await db.addMember("Secret2");
    await chooseStart(db, a, cluster[0]!, 1000);
    await chooseStart(db, b, cluster[1]!, 1000);
    const seen = await withRole(db.pool, asUser(a), (c) => c.query("select user_id from public.players"));
    expect(seen.rows.map((r) => r.user_id)).toEqual([a]);
  });

  it("une action trop fréquente est refusée, selon le réglage de la saison", async () => {
    const config = clone();
    config.limits.actionsPerMinute = 3;
    await openSeason(db, config);
    const member = await db.addMember("Rapide");
    for (let i = 0; i < 3; i++) expect(await chooseStart(db, member, 99_999, 1)).toMatchObject({ error: "territory_not_found" });
    expect(await chooseStart(db, member, cluster[0]!, 1)).toMatchObject({ ok: false, error: "rate_limited" });
  });
});
