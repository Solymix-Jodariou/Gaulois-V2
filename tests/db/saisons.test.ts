import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/lib/conquete/rules";
import { ANON, SERVICE, TestDb, asUser, type RpcResult } from "../support/database";
import { attack, chooseStart, clone, enlist, openSeason, place, playerRow, plainsCluster, seasonStatus, stateRow } from "../support/game";

let db: TestDb;
let admin: string;
let officer: string;
let member: string;
let cluster: number[];

beforeAll(async () => {
  db = await TestDb.create(inject("pgPort"));
  admin = await db.addMember("AdminSaison", "admin");
  officer = await db.addMember("OfficierSaison", "officer");
  member = await db.addMember("MembreSaison");
  cluster = plainsCluster(6);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.sql("update public.seasons set status = 'closed', closed_at = now() where status <> 'closed'");
});

const create = (who: string, name = "Saison", config: unknown = DEFAULT_CONFIG) => db.rpc<RpcResult & { id: number }>(asUser(who), "create_season", { p_name: name, p_config: config });

describe("lancer une saison", () => {
  it("réservé aux admins : ni un officier, ni un membre, ni un compte en attente", async () => {
    const pending = await db.addUser("SaisonAttente");
    expect(await create(member)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await create(officer)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await create(pending)).toMatchObject({ ok: false, error: "not_validated" });
    await expect(db.rpc(ANON, "create_season", { p_name: "x", p_config: DEFAULT_CONFIG })).rejects.toMatchObject({ code: "42501" });

    const { id } = await create(admin);
    for (const who of [member, officer]) {
      expect(await db.rpc(asUser(who), "start_season", { p_season: id })).toMatchObject({ ok: false, error: "forbidden" });
      expect(await db.rpc(asUser(who), "close_season", { p_season: id })).toMatchObject({ ok: false, error: "forbidden" });
      expect(await db.rpc(asUser(who), "update_season_config", { p_season: id, p_config: DEFAULT_CONFIG })).toMatchObject({ ok: false, error: "forbidden" });
      expect(await db.rpc(asUser(who), "set_war_date", { p_season: id, p_at: new Date().toISOString() })).toMatchObject({ ok: false, error: "forbidden" });
      expect(await db.rpc(asUser(who), "list_seasons")).toMatchObject({ ok: false, error: "forbidden" });
    }
  });

  it("une seule saison ouverte à la fois", async () => {
    await create(admin, "Une");
    expect(await create(admin, "Deux")).toMatchObject({ ok: false, error: "season_open" });
  });

  it("un brouillon reste invisible du public et on n'y joue pas", async () => {
    const { id } = await create(admin, "Brouillon");
    expect((await db.rpc<RpcResult & { season: null }>(ANON, "get_game_state")).season).toBeNull();
    expect(await chooseStart(db, member, cluster[0]!, 100)).toMatchObject({ ok: false, error: "no_active_season" });
    expect(await db.rpc(asUser(admin), "start_season", { p_season: id })).toMatchObject({ ok: true });
    expect(await seasonStatus(db, id)).toBe("expansion");
    expect(await db.rpc(asUser(admin), "start_season", { p_season: id })).toMatchObject({ ok: false, error: "season_not_draft" });
  });

  it("toute action sur une saison laisse une trace", async () => {
    const { id } = await create(admin, "Tracee");
    await db.rpc(asUser(admin), "start_season", { p_season: id });
    await db.rpc(asUser(admin), "close_season", { p_season: id });
    const log = await db.sql<{ action: string }>("select action from public.admin_log where details ->> 'season' = $1 order by id", [String(id)]);
    expect(log.map((l) => l.action)).toEqual(["season_created", "season_started", "season_closed"]);
  });
});

describe("les réglages", () => {
  it("les valeurs par défaut du fichier sont acceptées", async () => {
    expect(await create(admin)).toMatchObject({ ok: true });
  });

  it.each([
    ["un réglage manquant", (c: Record<string, unknown>) => delete c["startShare"], "{startShare}"],
    ["un mauvais type", (c: { capacity: Record<string, unknown> }) => (c.capacity["base"] = "beaucoup"), "{capacity,base}"],
    ["une base nulle, qui diviserait par zéro", (c: { capacity: Record<string, unknown> }) => (c.capacity["base"] = 0), "{capacity,base}"],
    ["un intervalle de régénération nul", (c: { regen: Record<string, unknown> }) => (c.regen["tickMinutes"] = 0), "{regen,tickMinutes}"],
    ["un rapport inversé", (c: { combat: Record<string, unknown> }) => (c.combat["ratioMin"] = 5), "{combat,ratioMin}"],
    ["une limite absurde", (c: { limits: Record<string, unknown> }) => (c.limits["attacksPerDay"] = 0), "{limits,attacksPerDay}"],
    ["un drapeau qui n'en est pas un", (c: { limits: Record<string, unknown> }) => (c.limits["lastTerritoryProtected"] = 1), "{limits,lastTerritoryProtected}"],
    ["une demi-heure de protection", (c: { limits: Record<string, unknown> }) => (c.limits["protectionHours"] = 1.5), "{limits,protectionHours}"],
    ["une attaque et demie par jour", (c: { limits: Record<string, unknown> }) => (c.limits["attacksPerDay"] = 1.5), "{limits,attacksPerDay}"],
  ])("refuse %s", async (_label, change, field) => {
    const config = clone();
    (change as (c: unknown) => unknown)(config);
    expect(await create(admin, "Mauvaise", config)).toMatchObject({ ok: false, error: "invalid_config", detail: { field } });
  });

  it("un admin les modifie en cours de saison : l'effet est immédiat, et l'ancien réglage reste au journal", async () => {
    const { id } = await create(admin);
    await db.rpc(asUser(admin), "start_season", { p_season: id });
    const changed = clone();
    changed.limits.expansionsPerDay = 7;
    expect(await db.rpc(asUser(admin), "update_season_config", { p_season: id, p_config: changed })).toMatchObject({ ok: true });
    const state = await db.rpc<RpcResult & { season: { config: { limits: { expansionsPerDay: number } } } }>(ANON, "get_game_state");
    expect(state.season.config.limits.expansionsPerDay).toBe(7);
    const [log] = await db.sql<{ details: { before: { limits: { expansionsPerDay: number } }; after: { limits: { expansionsPerDay: number } } } }>("select details from public.admin_log where action = 'season_config_changed' order by id desc limit 1");
    expect(log!.details.before.limits.expansionsPerDay).toBe(DEFAULT_CONFIG.limits.expansionsPerDay);
    expect(log!.details.after.limits.expansionsPerDay).toBe(7);

    await db.rpc(asUser(admin), "close_season", { p_season: id });
    expect(await db.rpc(asUser(admin), "update_season_config", { p_season: id, p_config: changed })).toMatchObject({ ok: false, error: "season_closed" });
  });
});

describe("clôturer une saison", () => {
  it("fige le classement, la carte et les donneurs, et les classements se lisent après coup", async () => {
    const { id, admin: seasonAdmin } = await openSeason(db);
    const big = await db.addMember("Grand");
    const conqueror = await db.addMember("Conquerant");
    await db.sql("update public.profiles set capsules_total = 5000, anonymous_donations = false where user_id = $1", [big]);
    await db.sql("update public.profiles set capsules_total = 9000, anonymous_donations = true where user_id = $1", [conqueror]);
    await db.rpc(asUser(seasonAdmin), "set_war_date", { p_season: id, p_at: new Date(Date.now() - 1000).toISOString() });
    await enlist(db, id, big, 1000);
    await enlist(db, id, conqueror, 100_000);
    // Les territoires se suivent : le deuxième touche le premier.
    const [a, home, b, c] = cluster as [number, number, number, number];
    await place(db, id, big, a, 100);
    await place(db, id, big, b, 100);
    await place(db, id, big, c, 100);
    await place(db, id, conqueror, home, 100);
    expect(await attack(db, conqueror, a, 20_000)).toMatchObject({ ok: true, won: true });

    expect(await db.rpc(asUser(seasonAdmin), "close_season", { p_season: id })).toMatchObject({ ok: true });
    expect(await db.rpc(asUser(seasonAdmin), "close_season", { p_season: id })).toMatchObject({ ok: false, error: "season_not_running" });

    const history = await db.rpc<RpcResult & { rows: { id: number; biggest: { name: string }; conqueror: { name: string } }[] }>(ANON, "get_season_history");
    expect(history.rows[0]).toMatchObject({ id, biggest: { name: expect.any(String) }, conqueror: { name: "Conquerant" } });

    const closed = await db.rpc<RpcResult & { standings: { name: string; territories: number; captured: number; rank_territories: number; rank_conquerors: number }[]; territories: { id: number; owner: number; garrison: number }[]; donors: { name: string | null; total: number }[] }>(ANON, "get_closed_season", { p_season: id });
    expect(closed.standings.find((s) => s.name === "Conquerant")).toMatchObject({ territories: 2, captured: 1, rank_conquerors: 1 });
    expect(closed.standings.find((s) => s.name === "Grand")).toMatchObject({ territories: 2, captured: 0, rank_territories: 1 });
    expect(closed.territories).toHaveLength(4);
    // L'anonymat vaut aussi pour l'historique.
    expect(closed.donors[0]).toMatchObject({ name: null, total: 9000 });
    expect(closed.donors[1]).toMatchObject({ name: "Grand", total: 5000 });

    // La partie est finie : plus aucune action.
    expect(await attack(db, conqueror, b, 100)).toMatchObject({ ok: false, error: "no_active_season" });

    // Ce qui suit ne change pas l'histoire.
    await db.sql("update public.profiles set display_name = 'Renomme' where user_id = $1", [big]);
    const again = await db.rpc<RpcResult & { standings: { name: string }[] }>(ANON, "get_closed_season", { p_season: id });
    expect(again.standings.map((s) => s.name)).toContain("Grand");
  });

  it("une saison non clôturée n'a pas de classement final", async () => {
    const { id } = await openSeason(db);
    expect(await db.rpc(ANON, "get_closed_season", { p_season: id })).toMatchObject({ ok: false, error: "season_not_found" });
  });

  it("le fil d'une saison finie se relit", async () => {
    const { id, admin: seasonAdmin } = await openSeason(db);
    const player = await db.addMember("Fil");
    await chooseStart(db, player, cluster[0]!, 100);
    await db.rpc(asUser(seasonAdmin), "close_season", { p_season: id });
    const feed = await db.rpc<RpcResult & { rows: { kind: string }[] }>(ANON, "get_feed", { p_season: id });
    expect(feed.rows.map((r) => r.kind)).toEqual(["season_closed", "start", "season_started"]);
  });
});

describe("modérer", () => {
  it("un officier exclut un joueur : ses terres redeviennent libres, il ne joue plus, et cela se journalise", async () => {
    const { id } = await openSeason(db);
    const cheater = await db.addMember("Exclu");
    await chooseStart(db, cheater, cluster[0]!, 100);
    const [{ gaul_number: number }] = (await db.sql<{ gaul_number: number }>("select gaul_number from public.profiles where user_id = $1", [cheater])) as [{ gaul_number: number }];

    expect(await db.rpc(asUser(officer), "exclude_player", { p_number: number, p_reason: "" })).toMatchObject({ ok: false, error: "invalid_reason" });
    expect(await db.rpc(asUser(member), "exclude_player", { p_number: number, p_reason: "non" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(officer), "exclude_player", { p_number: number, p_reason: "Comptes multiples" })).toMatchObject({ ok: true });

    expect(await stateRow(db, id, cluster[0]!)).toBeUndefined();
    expect((await playerRow(db, id, cheater))!.excluded_at).not.toBeNull();
    expect(await chooseStart(db, cheater, cluster[1]!, 100)).toMatchObject({ ok: false, error: "excluded" });
    const state = await db.rpc<RpcResult & { players: { name: string }[] }>(ANON, "get_game_state");
    expect(state.players.map((p) => p.name)).not.toContain("Exclu");
    expect(await db.sql("select 1 from public.admin_log where action = 'player_excluded' and target_id = $1", [cheater])).toHaveLength(1);

    const list = await db.rpc<RpcResult & { rows: { name: string; excluded_reason: string }[] }>(asUser(officer), "list_excluded_players");
    expect(list.rows[0]).toMatchObject({ name: "Exclu", excluded_reason: "Comptes multiples" });

    expect(await db.rpc(asUser(officer), "reinstate_player", { p_number: number })).toMatchObject({ ok: true });
    expect(await chooseStart(db, cheater, cluster[1]!, 100)).toMatchObject({ ok: true });
  });

  it("un officier n'exclut ni un autre officier ni un admin, ni lui-même", async () => {
    await openSeason(db);
    const other = await db.addMember("AutreOfficier", "officer");
    const numberOf = async (id: string) => (await db.sql<{ gaul_number: number }>("select gaul_number from public.profiles where user_id = $1", [id]))[0]!.gaul_number;
    expect(await db.rpc(asUser(officer), "exclude_player", { p_number: await numberOf(other), p_reason: "non" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(officer), "exclude_player", { p_number: await numberOf(admin), p_reason: "non" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await db.rpc(asUser(officer), "exclude_player", { p_number: await numberOf(officer), p_reason: "non" })).toMatchObject({ ok: false, error: "not_on_yourself" });
  });

  it("suspendre un membre le retire aussi de la saison", async () => {
    const { id } = await openSeason(db);
    const target = await db.addMember("SuspenduJeu");
    await chooseStart(db, target, cluster[0]!, 100);
    await db.rpc(asUser(admin), "suspend_member", { p_user: target, p_reason: "Parti du clan" });
    expect(await stateRow(db, id, cluster[0]!)).toBeUndefined();
  });

  it("effacer son compte libère ses terres, et le fil garde la trace sans nom", async () => {
    const { id } = await openSeason(db);
    const leaver = await db.addMember("Partant");
    await chooseStart(db, leaver, cluster[0]!, 100);
    expect(await db.rpc(asUser(leaver), "delete_my_account")).toMatchObject({ ok: true });
    expect(await stateRow(db, id, cluster[0]!)).toBeUndefined();
    const feed = await db.rpc<RpcResult & { rows: { kind: string; actor: string | null }[] }>(ANON, "get_feed");
    expect(feed.rows.find((r) => r.kind === "start")!.actor).toBeNull();
  });
});

describe("les dons de la saison en cours", () => {
  it("comptent à part du total : ni le total de départ ni les dons d'avant la saison", async () => {
    const donor = await db.addMember("DonneurSaison");
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
    const enter = (capsules: number, day: string, kind = "donation") =>
      db.rpc(asUser(officer), "enter_donation", { p_request_id: randomUUID(), p_user: donor, p_capsules: capsules, p_donated_on: day, p_kind: kind });
    const beforeSeason = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    expect(await enter(7_000_000, today, "opening")).toMatchObject({ ok: true });
    expect(await enter(300_000, beforeSeason)).toMatchObject({ ok: true });

    const noSeason = await db.rpc<RpcResult & { rows: { total: number; season: number | null }[]; season: string | null }>(ANON, "get_donor_ranking");
    expect(noSeason.season).toBeNull();
    expect(noSeason.rows.find((r) => r.total === 7_300_000)!.season).toBeNull();

    await openSeason(db);
    expect(await enter(50_000, today)).toMatchObject({ ok: true });
    const ranking = await db.rpc<RpcResult & { rows: { total: number; season: number | null; recent: number }[]; season: string }>(ANON, "get_donor_ranking");
    expect(ranking.season).toBe("Saison de test");
    expect(ranking.rows.find((r) => r.total === 7_350_000)).toMatchObject({ season: 50_000, recent: 50_000 });
  });
});

describe("la collecte et la sauvegarde", () => {
  it("seule la clé de service exporte, et l'export contient les données à sauver", async () => {
    await expect(db.rpc(asUser(admin), "export_all")).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(ANON, "export_all")).rejects.toMatchObject({ code: "42501" });
    const dump = await db.rpc<RpcResult & { profiles: unknown[]; donations: unknown[]; admin_log: unknown[]; exported_at: string }>(SERVICE, "export_all");
    expect(dump.ok).toBe(true);
    expect(dump.profiles.length).toBeGreaterThan(0);
    expect(Array.isArray(dump.donations)).toBe(true);
    expect(Date.parse(dump.exported_at)).toBeGreaterThan(0);
  });

  it("la tâche planifiée retient ce qu'elle a fait, et personne d'autre n'y touche", async () => {
    await expect(db.rpc(asUser(admin), "get_job_marks")).rejects.toMatchObject({ code: "42501" });
    await expect(db.rpc(asUser(admin), "set_job_mark", { p_key: "backup_at" })).rejects.toMatchObject({ code: "42501" });
    expect(await db.rpc(SERVICE, "set_job_mark", { p_key: "autre" })).toMatchObject({ ok: false, error: "invalid_request" });
    expect(await db.rpc(SERVICE, "set_job_mark", { p_key: "backup_at" })).toMatchObject({ ok: true });
    const marks = await db.rpc<RpcResult & { backup_at: string }>(SERVICE, "get_job_marks");
    expect(Date.parse(marks.backup_at)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("les événements marquants ne s'annoncent qu'une fois", async () => {
    const { id, admin: seasonAdmin } = await openSeason(db);
    await db.sql("update public.game_events set notified_at = now() where season_id <> $1", [id]);
    await expect(db.rpc(asUser(admin), "list_events_to_notify")).rejects.toMatchObject({ code: "42501" });
    const first = await db.rpc<RpcResult & { rows: { id: number; kind: string; season: string }[] }>(SERVICE, "list_events_to_notify");
    expect(first.rows.map((r) => r.kind)).toEqual(["season_started"]);
    await db.rpc(SERVICE, "mark_events_notified", { p_ids: first.rows.map((r) => r.id) });
    expect((await db.rpc<RpcResult & { rows: unknown[] }>(SERVICE, "list_events_to_notify")).rows).toEqual([]);
    await db.rpc(asUser(seasonAdmin), "close_season", { p_season: id });
    expect((await db.rpc<RpcResult & { rows: { kind: string }[] }>(SERVICE, "list_events_to_notify")).rows.map((r) => r.kind)).toEqual(["season_closed"]);
  });
});
