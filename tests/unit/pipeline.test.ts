import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPipeline, type Deps } from "../../src/lib/pipeline";

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

type Route = (url: URL) => { status?: number; body?: unknown } | undefined;

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
      return new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
    }) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => now,
    dataDir: dir,
    tag: "GAL",
    archiveStart: "2026-11-03",
    delayMs: 0,
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
    expect(errors).toHaveLength(2);
    expect(existsSync(join(dir, "members.json"))).toBe(false);
    expect(existsSync(join(dir, "sessions", "2026-11.json"))).toBe(false);
  });

  it("réessaie sur un 429 puis réussit", async () => {
    let n = 0;
    const { errors } = await runPipeline(
      deps((url) => (url.pathname.endsWith("/clans/leaderboard") && n++ === 0 ? { status: 429 } : undefined)),
    );
    expect(errors).toEqual([]);
    expect(calls.filter((c) => c.includes("leaderboard"))).toHaveLength(2);
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
