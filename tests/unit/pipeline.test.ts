import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPipeline, type Deps } from "../../src/lib/pipeline";
import { StoredGameFile } from "../../src/lib/schemas";

const clan = (clanTag: string, weightedWins: number) => ({
  clanTag,
  games: 10,
  wins: 4,
  losses: 6,
  playerSessions: 20,
  weightedWins,
  weightedLosses: 1,
  weightedWLRatio: 2,
  elo: null,
});
const session = (gameId: string, gameStart: string) => ({
  gameId,
  clanTag: "GAL",
  clanPlayerCount: 2,
  hasWon: true,
  numTeams: 2,
  playerTeams: "2",
  totalPlayerCount: 10,
  gameStart,
  score: 1,
});
const member = (publicId: string, username: string | null) => ({
  role: "member",
  joinedAt: "2026-05-03T20:17:40.935Z",
  publicId,
  username,
  stats: { team: { wins: 1, losses: 2 }, total: { wins: 50, losses: 50 } },
});

const rankedEntries = (ids: string[]) =>
  ids.map((public_id, i) => ({ rank: i + 1, elo: 2000 - i, peakElo: 2100, wins: 9, losses: 3, total: 12, public_id, accountUsername: "NomAPI", username: "NomAPI", level: 5 }));
const rankedPage = (ids: string[]) => ({ "1v1": rankedEntries(ids), "2v2": rankedEntries(ids), ffa: rankedEntries(ids) });

const player = (clientID: string, clanTag: string) => ({ clientID, clanTag, username: "NomSecret", publicID: "IdSecret", persistentID: "IdPersistant", stats: { gold: [1] } });
const game = (duration = 600) => ({
  info: {
    config: { gameMap: "World" },
    duration,
    winner: ["team", "Red", "a", "b"],
    players: [player("a", "GAL"), player("b", "GAL"), player("c", "UN"), player("d", "UN")],
  },
});

type Route =(url: URL) => { status?: number; body?: unknown; raw?: string } | undefined;

const healthy: Route = (url) => {
  const path = url.pathname.replace("/public", "");
  if (path === "/clans/leaderboard") {
    return { body: { start: "2026-08-07T09:00:00.000Z", end: "2026-11-05T09:00:00.000Z", clans: [clan("UN", 100), clan("GAL", 50)] } };
  }
  if (path === "/clan/GAL/exists") return { body: { exists: true } };
  if (path === "/clan/GAL/members") return { body: { results: [member("id1", "Alpha"), member("SECRET", null)], total: 2, page: 1, limit: 50 } };
  if (path === "/clan/GAL/sessions") {
    const day = url.searchParams.get("start")?.slice(0, 10);
    const results = day === "2026-11-04" ? [session("g1", `${day}T10:00:00.000Z`)] : [];
    return { body: { results: url.searchParams.get("page") === "1" ? results : [], total: results.length, page: 1, limit: 50 } };
  }
  if (path === "/leaderboard/ranked") return { body: rankedPage(url.searchParams.get("page") === "1" ? ["id1", "AUTRE", "SECRET"] : ["LOIN"]) };
  if (path.startsWith("/game/")) return { body: game() };
  if (path === "/players/recently-deleted") return { body: [] };
  if (path.startsWith("/player/")) return { body: { results: Array.from({ length: 3 }, () => ({ start: "2026-11-03T20:00:00.000Z", map: "World", mode: "Team", type: "Public", result: "victory", clanTag: "GAL" })), nextCursor: null } };
  return { status: 404 };
};

describe("runPipeline", () => {
  let dir: string;
  let calls: string[];
  let now: Date;

  const deps = (route: Route): Deps => ({
    fetch: (async (input: string) => {
      const url = new URL(input);
      calls.push(url.pathname + url.search);
      const r = route(url) ?? healthy(url);
      return new Response(r?.raw ?? JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
    }) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => now,
    dataDir: dir,
    tag: "GAL",
    archiveStart: "2026-11-03",
    delayMs: 0,
    memberGamesFile: join(dir, "cache", "players.json"),
    log: () => {},
  });
  const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gal-"));
    calls = [];
    now = new Date("2026-11-05T10:00:00.000Z");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("écrit tous les fichiers quand l'API répond", async () => {
    const { errors } = await runPipeline(deps(healthy));
    expect(errors).toEqual([]);
    expect(read("leaderboard.json").clans).toHaveLength(2);
    expect(read("members.json").total).toBe(2);
    expect(read("sessions/2026-11.json").sessions[0].gameId).toBe("g1");
    expect(read("meta.json").leaderboard.lastSuccessAt).toBe(now.toISOString());
  });

  it("archive un instantané sans donnée individuelle", async () => {
    await runPipeline(deps(healthy));
    const snap = read("history/2026-11-05.json");
    expect(snap).toMatchObject({ date: "2026-11-05", rank: 2, score: 50, games: 10, membersTotal: 2 });
    expect(JSON.stringify(snap)).not.toContain("Alpha");
  });

  it("n'écrit ni le publicId des anonymes ni les stats classées", async () => {
    await runPipeline(deps(healthy));
    const raw = readFileSync(join(dir, "members.json"), "utf8");
    expect(raw).not.toContain("SECRET");
    expect(raw).toContain("id1");
    expect(raw).not.toContain("total\":{\"wins");
  });

  it("note un rang absent si le clan sort de la liste", async () => {
    await runPipeline(
      deps((url) =>
        url.pathname.endsWith("/clans/leaderboard")
          ? { body: { start: "2026-08-07T09:00:00.000Z", end: "2026-11-05T09:00:00.000Z", clans: [clan("UN", 100)] } }
          : undefined,
      ),
    );
    expect(read("history/2026-11-05.json")).toMatchObject({ rank: null, score: null });
  });

  it("garde le dernier classement valide et signale la panne", async () => {
    await runPipeline(deps(healthy));
    const before = read("leaderboard.json");
    now = new Date("2026-11-05T11:00:00.000Z");
    const { errors } = await runPipeline(deps((url) => (url.pathname.endsWith("/clans/leaderboard") ? { status: 500 } : undefined)));
    expect(errors).toHaveLength(1);
    expect(read("leaderboard.json")).toEqual(before);
    const meta = read("meta.json");
    expect(meta.leaderboard.lastError).toContain("HTTP 500");
    expect(meta.leaderboard.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
    expect(meta.sessions.lastError).toBeNull();
  });

  it("ignore une réponse invalide au regard du schéma", async () => {
    await runPipeline(deps(healthy));
    const before = read("leaderboard.json");
    now = new Date("2026-11-05T11:00:00.000Z");
    await runPipeline(
      deps((url) =>
        url.pathname.endsWith("/clans/leaderboard")
          ? { body: { start: "2026-08-07T09:00:00.000Z", end: "2026-11-05T09:00:00.000Z", clans: "cassé" } }
          : undefined,
      ),
    );
    expect(read("leaderboard.json")).toEqual(before);
    expect(read("meta.json").leaderboard.lastError).toContain("réponse invalide");
  });

  it("refuse une liste de membres incomplète", async () => {
    const { errors } = await runPipeline(
      deps((url) =>
        url.pathname.endsWith("/members")
          ? { body: { results: url.searchParams.get("page") === "1" ? [member("id1", "Alpha")] : [], total: 2, page: 1, limit: 50 } }
          : undefined,
      ),
    );
    expect(errors[0]).toContain("incomplète");
    expect(existsSync(join(dir, "members.json"))).toBe(false);
  });

  it("n'écrit rien sur le clan si le tag n'existe pas", async () => {
    const { errors } = await runPipeline(deps((url) => (url.pathname.endsWith("/exists") ? { body: { exists: false } } : undefined)));
    expect(errors).toHaveLength(4);
    expect(read("meta.json").games.lastError).toContain("n'existe pas");
    expect(read("meta.json").memberGames.lastError).toContain("n'existe pas");
    expect(existsSync(join(dir, "members.json"))).toBe(false);
    expect(existsSync(join(dir, "sessions", "2026-11.json"))).toBe(false);
  });

  it("réessaie sur un 429 puis réussit", async () => {
    let n = 0;
    const { errors } = await runPipeline(
      deps((url) => (url.pathname.endsWith("/clans/leaderboard") && n++ === 0 ? { status: 429 } : undefined)),
    );
    expect(errors).toEqual([]);
    expect(calls.filter((c) => c.includes("/clans/leaderboard"))).toHaveLength(2);
  });

  it("ne relit que les jours non définitifs et ne duplique aucune session", async () => {
    await runPipeline(deps(healthy));
    expect(read("meta.json").sessions.completeThrough).toBe("2026-11-04");
    calls = [];
    now = new Date("2026-11-05T11:00:00.000Z");
    await runPipeline(deps(healthy));
    const days = calls.filter((c) => c.includes("/sessions")).map((c) => c.match(/start=(\d{4}-\d{2}-\d{2})/)?.[1]);
    expect(new Set(days)).toEqual(new Set(["2026-11-05"]));
    expect(read("sessions/2026-11.json").sessions).toHaveLength(1);
  });

  it("garde la couverture sans trou si un jour échoue", async () => {
    const { errors } = await runPipeline(
      deps((url) => (url.pathname.endsWith("/sessions") && url.searchParams.get("start")?.startsWith("2026-11-04") ? { status: 500 } : undefined)),
    );
    expect(errors).toHaveLength(1);
    const meta = read("meta.json").sessions;
    expect(meta.completeThrough).toBe("2026-11-03");
    expect(meta.coveredUntil).toBe("2026-11-03T23:59:59.999Z");
    expect(meta.lastSuccessAt).toBeNull();
  });

  it("ne relit les membres qu'une fois par jour", async () => {
    await runPipeline(deps(healthy));
    calls = [];
    now = new Date("2026-11-05T11:00:00.000Z");
    await runPipeline(deps(healthy));
    expect(calls.some((c) => c.includes("/members"))).toBe(false);
    now = new Date("2026-11-06T07:00:00.000Z");
    await runPipeline(deps(healthy));
    expect(calls.some((c) => c.includes("/members"))).toBe(true);
  });

  it("relève le classement du jour, dans l'ordre de l'API et sans donnée individuelle", async () => {
    await runPipeline(deps(healthy));
    const snap = read("rivals/2026-11-05.json");
    expect(snap.clans).toEqual([{ clanTag: "UN", weightedWins: 100 }, { clanTag: "GAL", weightedWins: 50 }]);
    expect(snap).toMatchObject({ date: "2026-11-05", leaderboardEnd: "2026-11-05T09:00:00.000Z" });
  });

  it("ne relève pas le classement du jour si l'API échoue", async () => {
    await runPipeline(deps((url) => (url.pathname.endsWith("/clans/leaderboard") ? { status: 500 } : undefined)));
    expect(existsSync(join(dir, "rivals", "2026-11-05.json"))).toBe(false);
  });

  it("n'écrit du classé que des décomptes, aucun joueur ni chiffre individuel", async () => {
    const { errors } = await runPipeline(deps(healthy));
    expect(errors).toEqual([]);
    const raw = readFileSync(join(dir, "ranked.json"), "utf8");
    expect(read("ranked.json").modes["1v1"]).toEqual({ listed: 4, members: 1, top: 1 });
    for (const absent of ["id1", "Alpha", "AUTRE", "SECRET", "LOIN", "NomAPI", "elo", "wins"]) expect(raw).not.toContain(absent);
    expect(calls.filter((c) => c.includes("/leaderboard/ranked"))).toEqual(["/public/leaderboard/ranked?page=1", "/public/leaderboard/ranked?page=2"]);
    expect(read("meta.json").ranked.lastSuccessAt).toBe(now.toISOString());
  });

  it("garde le dernier classé valide si une seule page échoue, et le signale", async () => {
    await runPipeline(deps(healthy));
    const before = read("ranked.json");
    now = new Date("2026-11-05T11:00:00.000Z");
    const { errors } = await runPipeline(
      deps((url) => (url.pathname.endsWith("/leaderboard/ranked") && url.searchParams.get("page") === "2" ? { status: 500 } : undefined)),
    );
    expect(errors).toHaveLength(1);
    expect(read("ranked.json")).toEqual(before);
    const meta = read("meta.json");
    expect(meta.ranked.lastError).toContain("HTTP 500");
    expect(meta.ranked.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
    expect(meta.leaderboard.lastError).toBeNull();
  });

  it("refuse un mode classé vide : garde le dernier relevé et le signale", async () => {
    await runPipeline(deps(healthy));
    const before = read("ranked.json");
    now = new Date("2026-11-05T11:00:00.000Z");
    const { errors } = await runPipeline(
      deps((url) => (url.pathname.endsWith("/leaderboard/ranked") ? { body: { "1v1": rankedEntries(["id1"]), "2v2": rankedEntries(["id1"]), ffa: [] } } : undefined)),
    );
    expect(errors[0]).toContain("classement classé vide : FFA");
    expect(read("ranked.json")).toEqual(before);
    expect(read("meta.json").ranked.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
  });

  it("n'appelle pas le classé sans liste de membres", async () => {
    await runPipeline(deps((url) => (url.pathname.endsWith("/exists") ? { body: { exists: false } } : undefined)));
    expect(calls.some((c) => c.includes("/leaderboard/ranked"))).toBe(false);
    expect(existsSync(join(dir, "ranked.json"))).toBe(false);
  });

  describe("détail des parties", () => {
    /** Plusieurs parties le même jour, de la plus ancienne à la plus récente : g0, g1, … */
    const withSessions =
      (count: number, games: Route): Route =>
      (url) => {
        if (url.pathname.endsWith("/clan/GAL/sessions")) {
          const day = url.searchParams.get("start")?.slice(0, 10);
          const results = day === "2026-11-04" ? Array.from({ length: count }, (_, i) => session(`g${i}`, `${day}T10:${String(i).padStart(2, "0")}:00.000Z`)) : [];
          return { body: { results: url.searchParams.get("page") === "1" ? results : [], total: results.length, page: 1, limit: 50 } };
        }
        return games(url);
      };
    /** Toutes les parties répondent, sauf celles que `special` traite autrement. */
    const gamesExcept =
      (special: (name: string) => ReturnType<Route>): Route =>
      (url) => {
        if (!url.pathname.includes("/game/")) return undefined;
        return special(url.pathname.split("/").at(-1) ?? "") ?? { body: game() };
      };
    const allAnswer = gamesExcept(() => undefined);
    const gameCalls = () => calls.filter((c) => c.includes("/public/game/"));
    const readIds = () => read("games/2026-11.json").games.map((g: { id: string }) => g.id);
    const gamesFile = () => join(dir, "games/2026-11.json");
    /** Le jour des parties n'est pas encore définitif : de nouvelles sessions peuvent apparaître d'un passage à l'autre. */
    const sameEvening = (time: string) => {
      now = new Date(`2026-11-04T${time}:00.000Z`);
    };

    it("lit chaque partie une seule fois et n'en écrit aucun joueur", async () => {
      const route = withSessions(1, allAnswer);
      const { errors } = await runPipeline(deps(route));
      expect(errors).toEqual([]);
      expect(gameCalls()).toEqual(["/public/game/g0?turns=false"]);
      expect(read("games/2026-11.json")).toEqual({
        month: "2026-11",
        games: [
          {
            id: "g0",
            map: "World",
            seconds: 600,
            win: 0,
            clans: [
              ["GAL", 2, 0],
              ["UN", 2, 1],
            ],
          },
        ],
      });
      const raw = readFileSync(gamesFile(), "utf8");
      for (const absent of ["NomSecret", "IdSecret", "IdPersistant"]) expect(raw).not.toContain(absent);
      expect(read("meta.json").games.lastSuccessAt).toBe(now.toISOString());

      calls = [];
      now = new Date("2026-11-05T11:00:00.000Z");
      await runPipeline(deps(route));
      expect(gameCalls()).toEqual([]);
      expect(read("games/2026-11.json").games).toHaveLength(1);
    });

    it("commence par les plus récentes et s'arrête au nombre prévu par passage", async () => {
      const route = withSessions(3, allAnswer);
      await runPipeline({ ...deps(route), gamesPerRun: 2 });
      expect(gameCalls()).toEqual(["/public/game/g2?turns=false", "/public/game/g1?turns=false"]);
      calls = [];
      await runPipeline({ ...deps(route), gamesPerRun: 2 });
      expect(gameCalls()).toEqual(["/public/game/g0?turns=false"]);
      expect(readIds()).toEqual(["g2", "g1", "g0"]);
    });

    it.each([
      ["une partie inconnue de l'API", { status: 404 }],
      ["une erreur du serveur", { status: 500 }],
      ["une réponse qui n'est pas du JSON", { raw: "<html>panne</html>" }],
      ["une réponse au mauvais format", { body: { info: "cassé" } }],
    ])("passe à la suite sans annoncer de panne, puis relit la partie : %s", async (_label, failure) => {
      const route = withSessions(3, gamesExcept((name) => (name === "g1" ? failure : undefined)));
      const { errors } = await runPipeline(deps(route));
      expect(errors).toEqual(["parties sans réponse lisible, à relire : 1"]);
      expect(readIds()).toEqual(["g2", "g0"]);
      const meta = read("meta.json");
      expect(meta.games.lastError).toBeNull();
      expect(meta.games.lastSuccessAt).toBe(now.toISOString());

      calls = [];
      await runPipeline(deps(withSessions(3, allAnswer)));
      expect(gameCalls()).toEqual(["/public/game/g1?turns=false"]);
      expect(readIds()).toEqual(["g2", "g0", "g1"]);
    });

    it("ne perd aucune partie si l'API répond 404 partout quand il n'en reste que quelques-unes à lire, et finit par le signaler", async () => {
      sameEvening("23:00");
      const down = gamesExcept(() => ({ status: 404 }));
      const first = await runPipeline(deps(withSessions(3, down)));
      expect(first.errors).toEqual(["parties sans réponse lisible, à relire : 3"]);
      expect(read("meta.json").games.lastError).toBeNull();
      expect(existsSync(gamesFile())).toBe(false);

      sameEvening("23:30");
      const second = await runPipeline(deps(withSessions(6, down)));
      expect(second.errors[0]).toContain("parties : 6 parties sans réponse lisible, 0 lues");
      expect(read("meta.json").games.lastError).toContain("HTTP 404");
      expect(existsSync(gamesFile())).toBe(false);

      sameEvening("23:45");
      await runPipeline(deps(withSessions(6, allAnswer)));
      expect(readIds()).toHaveLength(6);
      expect(read("meta.json").games.lastError).toBeNull();
    });

    it("ne perd aucune partie si une réponse sur trois est un 404", async () => {
      const route = withSessions(9, gamesExcept((name) => (Number(name.slice(1)) % 3 === 0 ? { status: 404 } : undefined)));
      await runPipeline(deps(route));
      expect(readIds()).toHaveLength(6);
      calls = [];
      await runPipeline(deps(withSessions(9, allAnswer)));
      expect(gameCalls()).toHaveLength(3);
      expect(readIds()).toHaveLength(9);
    });

    it("n'est pas bloquée par des parties cassées qui restent en tête de file", async () => {
      const route = withSessions(10, gamesExcept((name) => (Number(name.slice(1)) >= 3 ? { status: 500 } : undefined)));
      const { errors } = await runPipeline(deps(route));
      expect(errors).toEqual(["parties sans réponse lisible, à relire : 7"]);
      expect(readIds()).toEqual(["g2", "g1", "g0"]);
      expect(read("meta.json").games.lastError).toBeNull();
    });

    it("s'arrête à 25 échecs dans un passage, garde ce qui est lu et le signale", async () => {
      const route = withSessions(30, gamesExcept((name) => (Number(name.slice(1)) >= 27 ? undefined : { status: 404 })));
      const { errors } = await runPipeline(deps(route));
      expect(errors[0]).toContain("parties : 25 parties sans réponse lisible, 3 lues");
      expect(gameCalls()).toHaveLength(28);
      expect(readIds()).toEqual(["g29", "g28", "g27"]);
      const meta = read("meta.json");
      expect(meta.games.lastError).toContain("HTTP 404");
      expect(meta.games.lastSuccessAt).toBeNull();
      expect(meta.sessions.lastError).toBeNull();
    });

    it("ne change pas la date de mise à jour si rien n'a pu être lu, sans annoncer de panne pour autant", async () => {
      sameEvening("23:00");
      await runPipeline(deps(withSessions(1, allAnswer)));
      sameEvening("23:30");
      await runPipeline(deps(withSessions(3, gamesExcept((name) => (name === "g0" ? undefined : { status: 500 })))));
      const meta = read("meta.json");
      expect(meta.games.lastSuccessAt).toBe("2026-11-04T23:00:00.000Z");
      expect(meta.games.lastError).toBeNull();
    });

    it("garde le dernier état valide si toute la route tombe après un premier passage réussi", async () => {
      await runPipeline({ ...deps(withSessions(7, allAnswer)), gamesPerRun: 1 });
      const before = read("games/2026-11.json");
      expect(before.games).toHaveLength(1);
      now = new Date("2026-11-05T11:00:00.000Z");
      await runPipeline(deps(withSessions(7, gamesExcept(() => ({ status: 500 })))));
      expect(read("games/2026-11.json")).toEqual(before);
      const meta = read("meta.json");
      expect(meta.games.lastError).toContain("HTTP 500");
      expect(meta.games.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
    });

    it("n'écrit pas une partie dont le résumé serait invalide : le fichier du mois reste lisible", async () => {
      const route = withSessions(2, gamesExcept((name) => (name === "g1" ? { body: game(1e300) } : undefined)));
      const { errors } = await runPipeline(deps(route));
      expect(errors).toEqual(["parties sans réponse lisible, à relire : 1"]);
      expect(readIds()).toEqual(["g0"]);
      expect(StoredGameFile.safeParse(read("games/2026-11.json")).success).toBe(true);
    });

    it("n'appelle aucune partie si le tag n'existe pas", async () => {
      await runPipeline(deps((url) => (url.pathname.endsWith("/exists") ? { body: { exists: false } } : undefined)));
      expect(gameCalls()).toEqual([]);
    });
  });

  describe("fiches des membres", () => {
    const line = (over: Record<string, unknown> = {}) => ({ gameId: "g", start: "2026-11-03T20:00:00.000Z", durationSeconds: 100, map: "World", mode: "Team", type: "Public", playerTeams: "Duos", rankedType: "unranked", result: "victory", totalPlayers: 8, username: "NomAPI", clanTag: "GAL", ...over });
    const games = (rows: unknown[], nextCursor: string | null = null) => ({ body: { results: rows, nextCursor } });
    const lines = (count: number, over: Record<string, unknown> = {}) => Array.from({ length: count }, () => line(over));
    const withMembers =
      (list: unknown[], other: Route = () => undefined): Route =>
      (url) => {
        if (url.pathname.endsWith("/members")) return { body: { results: list, total: list.length, page: 1, limit: 50 } };
        return other(url);
      };
    const withRecord = (id: string, username: string | null, wins: number, losses: number) => ({ ...member(id, username), stats: { team: { wins, losses } } });
    /** Réponses exactes pour chaque joueur : autant de parties sous le tag que ses stats en annoncent. */
    const answering =
      (counts: Record<string, number>): Route =>
      (url) => {
        const id = url.pathname.match(/\/player\/([^/]+)\/games$/)?.[1];
        return id ? games(lines(counts[id] ?? 0)) : undefined;
      };
    const playerCalls = () => calls.filter((c) => c.includes("/public/player/"));
    const storedPath = () => join(dir, "cache", "players.json");
    const stored = () => JSON.parse(readFileSync(storedPath(), "utf8"));

    it("garde les parties sous le tag d'un membre avec pseudo, sans aucun joueur, ni heure, ni nombre de parties hors du tag", async () => {
      const route = withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("SECRET", null, 5, 5)], (url) => (url.pathname.endsWith("/player/id1/games") ? games([line(), line({ clanTag: null, map: "SansTag" }), line({ result: "defeat", map: "Asia" })]) : undefined));
      const { errors } = await runPipeline(deps(route));
      expect(errors).toEqual([]);
      expect(stored()).toEqual({
        id1: {
          seen: 2,
          readOn: "2026-11-05",
          recent: [
            { date: "2026-11-03", map: "World", teams: "Duos", result: "victory" },
            { date: "2026-11-03", map: "Asia", teams: "Duos", result: "defeat" },
          ],
        },
      });
      const raw = readFileSync(storedPath(), "utf8");
      for (const absent of ["SECRET", "Alpha", "NomAPI", "20:00", '"g"', "SansTag", "scanned"]) expect(raw).not.toContain(absent);
      expect(read("meta.json").memberGames.lastSuccessAt).toBe(now.toISOString());
    });

    it("n'écrit pas les parties de chaque joueur dans data/, donc pas dans Git", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 0)], answering({ id1: 1 }))));
      expect(existsSync(storedPath())).toBe(true);
      expect(existsSync(join(dir, "member-games.json"))).toBe(false);
      expect(readFileSync(join(dir, "meta.json"), "utf8")).not.toContain("World");
    });

    it("n'appelle jamais de partie pour un anonyme, ni pour un membre sans partie sous le tag", async () => {
      await runPipeline(deps(withMembers([withRecord("SECRET", null, 5, 5), withRecord("id2", "Bravo", 0, 0)])));
      expect(playerCalls()).toEqual([]);
    });

    it("ne relit un joueur que si ses parties selon stats.team ont bougé", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1)], answering({ id1: 2 }))));
      expect(playerCalls()).toHaveLength(1);
      calls = [];
      now = new Date("2026-11-05T11:00:00.000Z");
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1)], answering({ id1: 2 }))));
      expect(playerCalls()).toEqual([]);
      calls = [];
      now = new Date("2026-11-06T09:00:00.000Z");
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 2, 1)], answering({ id1: 3 }))));
      expect(playerCalls()).toHaveLength(1);
      expect(stored().id1).toMatchObject({ seen: 3, readOn: "2026-11-06" });
    });

    it("lit la page suivante s'il manque des parties sous le tag, et s'arrête à 3 pages sans rien dire de ce qu'il a trouvé d'autre", async () => {
      const route = withMembers([withRecord("id1", "Alpha", 40, 0)], (url) => {
        if (!url.pathname.endsWith("/player/id1/games")) return undefined;
        const next = Number(url.searchParams.get("cursor") ?? 0) + 1;
        return games(lines(10, { clanTag: null }), String(next));
      });
      await runPipeline(deps(route));
      expect(playerCalls()).toHaveLength(3);
      expect(playerCalls().every((c) => c.includes("filter=team&type=public"))).toBe(true);
      expect(playerCalls()[1]).toContain("cursor=1");
      expect(stored().id1).toEqual({ seen: 40, readOn: "2026-11-05", recent: [] });
    });

    it("s'arrête dès qu'il a les 10 parties voulues", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 40, 0)], (url) => (url.pathname.endsWith("/player/id1/games") ? games(lines(10), "suite") : undefined))));
      expect(playerCalls()).toHaveLength(1);
      expect(stored().id1.recent).toHaveLength(10);
    });

    it("s'arrête dès qu'il a toutes les parties que stats.team annonce, même si l'historique continue", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1)], (url) => (url.pathname.endsWith("/player/id1/games") ? games([line(), line(), line({ clanTag: null })], "suite") : undefined))));
      expect(playerCalls()).toHaveLength(1);
      expect(stored().id1.recent).toHaveLength(2);
    });

    it("ne remplace pas une liste valide par une réponse vide, et la relit au passage suivant", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 3, 1)], answering({ id1: 4 }))));
      const before = stored().id1;
      expect(before.recent).toHaveLength(4);

      now = new Date("2026-11-06T09:00:00.000Z");
      const { errors } = await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 4, 1)], answering({ id1: 0 }))));
      expect(errors).toEqual(["fiches sans réponse lisible, à relire : 1"]);
      expect(stored().id1).toEqual(before);

      calls = [];
      now = new Date("2026-11-06T10:00:00.000Z");
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 4, 1)], answering({ id1: 5 }))));
      expect(playerCalls()).toHaveLength(1);
      expect(stored().id1).toMatchObject({ seen: 5 });
      expect(stored().id1.recent).toHaveLength(5);
    });

    it("oublie un membre parti ou qui a retiré son pseudo", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", "Bravo", 1, 1)], answering({ id1: 2, id2: 2 }))));
      expect(Object.keys(stored())).toEqual(["id1", "id2"]);
      now = new Date("2026-11-06T09:00:00.000Z");
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", null, 1, 1)], answering({ id1: 2 }))));
      expect(Object.keys(stored())).toEqual(["id1"]);
      expect(readFileSync(storedPath(), "utf8")).not.toContain("id2");
    });

    it("oublie un membre qui retire son pseudo, même si la liste des comptes supprimés est en panne", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", "Bravo", 1, 1)], answering({ id1: 2, id2: 2 }))));
      now = new Date("2026-11-06T09:00:00.000Z");
      const { errors } = await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", null, 1, 1)], (url) => (url.pathname.endsWith("/players/recently-deleted") ? { status: 500 } : undefined))));
      expect(errors[0]).toContain("fiches des membres : HTTP 500");
      expect(Object.keys(stored())).toEqual(["id1"]);
    });

    it("oublie un membre qui retire son pseudo, même si l'API est tombée à ce moment-là", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", "Bravo", 1, 1)], answering({ id1: 2, id2: 2 }))));
      now = new Date("2026-11-06T09:00:00.000Z");
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", null, 1, 1)], answering({ id1: 2 }))));
      calls = [];
      now = new Date("2026-11-06T10:00:00.000Z");
      await runPipeline(deps((url) => (url.pathname.endsWith("/exists") ? { body: { exists: false } } : undefined)));
      expect(playerCalls()).toEqual([]);
      expect(calls.some((c) => c.includes("recently-deleted"))).toBe(false);
      expect(Object.keys(stored())).toEqual(["id1"]);
    });

    it("retire aussitôt un compte supprimé, de la liste et des fiches, sans attendre la relecture de la liste", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1), withRecord("id2", "Bravo", 1, 1)], answering({ id1: 2, id2: 2 }))));
      now = new Date("2026-11-05T11:00:00.000Z");
      calls = [];
      const { errors } = await runPipeline(deps((url) => (url.pathname.endsWith("/players/recently-deleted") ? { body: [{ publicId: "id2", deletedAt: "2026-11-05T10:30:00.000Z" }] } : undefined)));
      expect(errors).toEqual([]);
      expect(calls.some((c) => c.includes("/members"))).toBe(false);
      const list = read("members.json");
      expect(list.total).toBe(1);
      expect(JSON.stringify(list)).not.toContain("Bravo");
      expect(Object.keys(stored())).toEqual(["id1"]);
    });

    it("ne lit pas de nouvelles fiches si la liste des comptes supprimés ne répond pas, et le signale", async () => {
      const route = withMembers([withRecord("id1", "Alpha", 1, 1)], (url) => (url.pathname.endsWith("/players/recently-deleted") ? { status: 500 } : undefined));
      const { errors } = await runPipeline(deps(route));
      expect(errors[0]).toContain("fiches des membres : HTTP 500");
      expect(playerCalls()).toEqual([]);
      expect(existsSync(storedPath())).toBe(false);
      expect(read("meta.json").memberGames.lastError).toContain("HTTP 500");
      expect(read("meta.json").members.lastError).toBeNull();
    });

    it("passe à la suite après un échec isolé, le relit ensuite et n'annonce pas de panne", async () => {
      const list = [withRecord("id1", "Alpha", 1, 1), withRecord("id2", "Bravo", 1, 1)];
      const { errors } = await runPipeline(deps(withMembers(list, (url) => (url.pathname.endsWith("/player/id1/games") ? { status: 404 } : answering({ id2: 2 })(url)))));
      expect(errors).toEqual(["fiches sans réponse lisible, à relire : 1"]);
      expect(Object.keys(stored())).toEqual(["id2"]);
      expect(read("meta.json").memberGames.lastError).toBeNull();
      calls = [];
      now = new Date("2026-11-05T11:00:00.000Z");
      await runPipeline(deps(withMembers(list, answering({ id1: 2, id2: 2 }))));
      expect(playerCalls()).toHaveLength(1);
      expect(Object.keys(stored()).sort()).toEqual(["id1", "id2"]);
    });

    it("signale une panne de la route sans rien perdre de ce qui est gardé, et sans écrire d'identifiant dans le message public", async () => {
      const list = Array.from({ length: 6 }, (_, i) => withRecord(`id${i}`, `Nom${i}`, 1, 1));
      const counts = Object.fromEntries(list.map((_, i) => [`id${i}`, 2]));
      await runPipeline(deps(withMembers(list, answering(counts))));
      const before = stored();
      expect(Object.keys(before)).toHaveLength(6);

      now = new Date("2026-11-06T09:00:00.000Z");
      const changed = list.map((_, i) => withRecord(`id${i}`, `Nom${i}`, 2, 1));
      const { errors } = await runPipeline(deps(withMembers(changed, (url) => (url.pathname.includes("/player/") ? { status: 404 } : undefined))));
      expect(errors[0]).toContain("fiches des membres : 6 fiches sans réponse lisible, 0 lues");
      expect(stored()).toEqual(before);
      const meta = read("meta.json");
      expect(meta.memberGames.lastError).toContain("HTTP 404");
      expect(meta.memberGames.lastError).not.toMatch(/id\d/);
      expect(meta.memberGames.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
    });

    it("respecte à peu près le nombre d'appels prévu, et commence par ceux jamais lus", async () => {
      const list = Array.from({ length: 5 }, (_, i) => withRecord(`id${i}`, `Nom${i}`, 1, 1));
      const counts = Object.fromEntries(list.map((_, i) => [`id${i}`, 2]));
      await runPipeline({ ...deps(withMembers(list, answering(counts))), memberCallsPerRun: 2 });
      expect(playerCalls()).toHaveLength(2);
      expect(Object.keys(stored())).toEqual(["id0", "id1"]);
      calls = [];
      now = new Date("2026-11-06T09:00:00.000Z");
      const changed = list.map((m, i) => (i === 0 ? withRecord("id0", "Nom0", 9, 9) : m));
      await runPipeline({ ...deps(withMembers(changed, answering({ ...counts, id0: 18 }))), memberCallsPerRun: 2 });
      expect(playerCalls().map((c) => c.split("/")[3])).toEqual(["id2", "id3"]);
    });

    it("n'appelle pas les fiches si le tag n'existe pas", async () => {
      await runPipeline(deps(withMembers([withRecord("id1", "Alpha", 1, 1)], answering({ id1: 2 }))));
      calls = [];
      now = new Date("2026-11-05T11:00:00.000Z");
      await runPipeline(deps((url) => (url.pathname.endsWith("/exists") ? { body: { exists: false } } : undefined)));
      expect(playerCalls()).toEqual([]);
      expect(calls.some((c) => c.includes("recently-deleted"))).toBe(false);
    });
  });

  it("n'interroge jamais une fenêtre de plus d'un jour ni une date future", async () => {
    await runPipeline(deps(healthy));
    for (const c of calls.filter((x) => x.includes("/sessions"))) {
      const url = new URL(c, "https://x");
      const span = Date.parse(url.searchParams.get("end") ?? "") - Date.parse(url.searchParams.get("start") ?? "");
      expect(span).toBeLessThanOrEqual(86_400_000);
      expect(Date.parse(url.searchParams.get("start") ?? "")).toBeLessThan(now.getTime());
    }
  });
});
