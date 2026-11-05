import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEventLog, runClanMap, type ClanMapDeps } from "../../src/lib/clanmap/collect";
import { Meta, StoredClanMapFilm } from "../../src/lib/schemas";

const WIDTH = 8;
const HEIGHT = 4;
type Event = [string, number, number, string];

const HISTORY: Event[] = [
  ["1", 0, 0, "9"],
  ["2", 1, 0, "43"],
  ["4", 0, 0, "43"], // Les numéros ont des trous, comme dans la vraie API.
  ["5", 2, 0, "9"],
];
const CLANS = {
  "9": { tag: "ITA", name: "Italy", troops: 10, color: 0x112233 },
  "43": { tag: "GAL", name: "Les Gaulois", troops: 20, color: 0x38bdf8 },
};

/** La carte après les événements donnés, au format de l'API. */
function ownershipOf(events: Event[]) {
  const grid = new Uint16Array(WIDTH * HEIGHT);
  const ids = ["9", "43"];
  for (const [, x, y, id] of events) grid[y * WIDTH + x] = id === "0" ? 0 : ids.indexOf(id) + 1;
  const bytes = Buffer.alloc(grid.length * 4);
  grid.forEach((clan, i) => {
    bytes.writeUInt16LE(clan, i * 4);
    bytes.writeUInt16LE(1, i * 4 + 2);
  });
  return {
    seq: events.at(-1)?.[0] ?? "0",
    width: WIDTH,
    height: HEIGHT,
    clans: ids.map((id) => ({ id, ...CLANS[id as keyof typeof CLANS] })),
    rle: bytes.toString("base64"),
  };
}

type Route = (url: URL) => { status?: number; body?: unknown; bytes?: Uint8Array } | undefined;

describe("collecte de la carte", () => {
  let dir: string;
  let cache: string;
  let calls: string[];
  let now: Date;
  let history: Event[];

  const healthy: Route = (url) => {
    if (url.pathname === "/clanmap/ownership") return { body: ownershipOf(history) };
    if (url.pathname === "/clanmap/changes") {
      const since = Number(url.searchParams.get("since"));
      const changes = history.filter((e) => Number(e[0]) > since).slice(0, 2);
      return { body: { seq: changes.at(-1)?.[0] ?? String(since), changes, clans: CLANS } };
    }
    if (url.pathname === "/clanmap/terrain") return { bytes: gzipSync(Buffer.alloc(WIDTH * HEIGHT, 128)) };
    if (url.pathname === "/clans/GAL") return { body: { tag: "GAL", softBalance: "19279", hardBalance: "878", troops: 8000, memberCount: 760 } };
    return { status: 404 };
  };

  const deps = (route: Route = () => undefined, extra: Partial<ClanMapDeps> = {}): ClanMapDeps => ({
    fetch: (async (input: string) => {
      const url = new URL(input);
      calls.push(url.pathname + url.search);
      const r = route(url) ?? healthy(url);
      return new Response(r?.bytes ? Buffer.from(r.bytes) : JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
    }) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => now,
    dataDir: dir,
    cacheDir: cache,
    tag: "GAL",
    archiveStart: "2026-11-03",
    delayMs: 0,
    log: () => {},
    ...extra,
  });
  const film = () => StoredClanMapFilm.parse(JSON.parse(readFileSync(join(dir, "clanmap", "film.json"), "utf8")));
  const meta = () => Meta.parse(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gal-carte-"));
    cache = join(dir, "cache");
    calls = [];
    now = new Date("2026-11-05T10:00:00.000Z");
    history = [...HISTORY];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("écrit le film, le fond de carte et les chiffres de GAL", async () => {
    const run = await runClanMap(deps());
    expect(run).toEqual({ errors: [], updated: true });
    const f = film();
    expect(f).toMatchObject({ seq: 5, events: 4, land: WIDTH * HEIGHT, claimed: 3, cols: 4, rows: 2 });
    expect(f.check).toEqual({ seq: 5, pixels: WIDTH * HEIGHT, mismatches: 0 });
    expect(f.galSummary).toMatchObject({ pixels: 2, rank: 1, firstEvent: 2, taken: 2, lost: 0, neutralTaken: 1 });
    // ITA a un pixel en (2, 0), au contact de GAL en (1, 0). Il coûte 2 000 + 10 troupes.
    expect(f.galSummary?.fronts).toEqual([{ tag: "ITA", clan: 1, taken: 1, lost: 0, border: 1, at: [1, 0], pixelCost: 2010 }]);
    expect(f.galSummary).toMatchObject({ zoneCount: 1, neutralBorder: 2 });
    expect(f.galSummary?.zones[0]).toMatchObject({ pixels: 2 });
    expect(f.standings.map((c) => [c.tag, c.pixels, c.troops])).toEqual([["GAL", 2, 20], ["ITA", 1, 10]]);
    expect(f.treasury).toEqual({ caps: 19279, troops: 8000, members: 760 });
    expect(existsSync(join(dir, "clanmap", "film.bin"))).toBe(true);
    expect(existsSync(join(dir, "clanmap", "terrain.webp"))).toBe(true);
    expect(meta().clanmap.lastSuccessAt).toBe(now.toISOString());
  });

  it("ne garde aucun identifiant de joueur, ni le plutonium, ni les noms des clans", async () => {
    await runClanMap(deps());
    const raw = readFileSync(join(dir, "clanmap", "film.json"), "utf8");
    expect(raw).not.toContain("publicId");
    expect(raw).not.toContain("878");
    expect(raw).not.toContain("Les Gaulois");
  });

  it("garde le film si la fiche du clan est indisponible, sans inventer de trésor", async () => {
    const run = await runClanMap(deps((url) => (url.pathname === "/clans/GAL" ? { status: 500 } : undefined)));
    expect(run).toEqual({ errors: [], updated: true });
    // Les troupes viennent alors de l'instantané ; les capsules restent inconnues.
    expect(film().treasury).toEqual({ caps: null, troops: 20, members: null });
  });

  it("tient un journal d'un relevé par jour, sans réécrire les jours passés", async () => {
    await runClanMap(deps());
    history.push(["7", 3, 0, "43"]);
    now = new Date("2026-11-05T22:00:00.000Z");
    await runClanMap(deps(undefined, { force: true }));
    now = new Date("2026-11-07T10:00:00.000Z");
    history.push(["8", 4, 0, "43"]);
    await runClanMap(deps());
    const journal = JSON.parse(readFileSync(join(dir, "clanmap", "journal.json"), "utf8"));
    expect(journal.map((e: { date: string; pixels: number }) => [e.date, e.pixels])).toEqual([
      ["2026-11-05", 3],
      ["2026-11-07", 4],
    ]);
    expect(journal[0]).toMatchObject({ rank: 1, caps: 19279, troops: 8000 });
  });

  it("laisse intact le reste d'un meta.json plus ancien", async () => {
    const old = {
      lastRunAt: "2026-11-05T09:00:00.000Z",
      leaderboard: { lastSuccessAt: "2026-11-05T09:00:00.000Z", lastErrorAt: null, lastError: null },
      members: { lastSuccessAt: null, lastErrorAt: null, lastError: null },
      sessions: { lastSuccessAt: null, lastErrorAt: null, lastError: null, completeThrough: "2026-11-03", coveredUntil: null },
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(old));
    await runClanMap(deps());
    expect(meta().sessions.completeThrough).toBe("2026-11-03");
    expect(meta().leaderboard.lastSuccessAt).toBe("2026-11-05T09:00:00.000Z");
  });

  it("ne relit la carte qu'une fois par jour", async () => {
    await runClanMap(deps());
    calls = [];
    now = new Date("2026-11-05T11:00:00.000Z");
    expect(await runClanMap(deps())).toEqual({ errors: [], updated: false });
    expect(calls).toEqual([]);
    now = new Date("2026-11-06T07:00:00.000Z");
    expect((await runClanMap(deps())).updated).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("le mode forcé ignore ce délai", async () => {
    await runClanMap(deps());
    now = new Date("2026-11-05T11:00:00.000Z");
    expect((await runClanMap(deps(undefined, { force: true }))).updated).toBe(true);
  });

  it("reprend après le dernier événement connu et ne relit pas tout", async () => {
    await runClanMap(deps());
    history.push(["7", 3, 0, "43"], ["8", 1, 1, "0"]);
    calls = [];
    now = new Date("2026-11-06T10:00:00.000Z");
    await runClanMap(deps());
    const asked = calls.filter((c) => c.includes("/changes")).map((c) => Number(c.split("since=")[1]));
    expect(Math.min(...asked)).toBe(5);
    expect(film()).toMatchObject({ seq: 8, events: 6 });
    expect(film().galSummary?.pixels).toBe(3);
    expect(calls.some((c) => c.includes("/terrain"))).toBe(false);
  });

  it("garde le dernier film valide et signale la panne", async () => {
    await runClanMap(deps());
    const before = readFileSync(join(dir, "clanmap", "film.json"), "utf8");
    now = new Date("2026-11-06T10:00:00.000Z");
    const run = await runClanMap(deps((url) => (url.pathname === "/clanmap/ownership" ? { status: 500 } : undefined)));
    expect(run.updated).toBe(false);
    expect(run.errors[0]).toContain("HTTP 500");
    expect(readFileSync(join(dir, "clanmap", "film.json"), "utf8")).toBe(before);
    expect(meta().clanmap.lastError).toContain("HTTP 500");
    expect(meta().clanmap.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
  });

  it("refuse de publier un film qui ne retombe pas sur la carte du jeu", async () => {
    const wrong = ownershipOf(HISTORY);
    const bytes = Buffer.from(wrong.rle, "base64");
    bytes.writeUInt16LE(2, 7 * 4); // Un pixel de plus pour GAL dans l'instantané.
    const run = await runClanMap(deps((url) => (url.pathname === "/clanmap/ownership" ? { body: { ...wrong, rle: bytes.toString("base64") } } : undefined)));
    expect(run.errors[0]).toContain("1 pixels");
    expect(existsSync(join(dir, "clanmap", "film.json"))).toBe(false);
    expect(meta().clanmap.lastSuccessAt).toBeNull();
  });

  it("refuse un événement hors de la carte sans l'ajouter à l'historique", async () => {
    const run = await runClanMap(
      deps((url) =>
        url.pathname === "/clanmap/changes" && url.searchParams.get("since") === "0"
          ? { body: { seq: "1", changes: [["1", WIDTH, 0, "9"]], clans: CLANS } }
          : undefined,
      ),
    );
    expect(run.errors[0]).toContain("hors de la carte");
    expect(existsSync(join(cache, "events.bin"))).toBe(false);
  });

  it("refuse un événement qui remonte le temps", async () => {
    const run = await runClanMap(
      deps((url) =>
        url.pathname === "/clanmap/changes" && url.searchParams.get("since") === "0"
          ? { body: { seq: "2", changes: [["2", 0, 0, "9"], ["2", 1, 0, "9"]], clans: CLANS } }
          : undefined,
      ),
    );
    expect(run.errors[0]).toContain("hors d'ordre");
  });

  it("ignore une réponse invalide", async () => {
    const run = await runClanMap(deps((url) => (url.pathname === "/clanmap/changes" ? { body: { seq: "x", changes: "cassé" } } : undefined)));
    expect(run.errors[0]).toContain("réponse invalide");
    expect(existsSync(join(dir, "clanmap", "film.json"))).toBe(false);
  });

  it("conserve les pages déjà lues si la suite échoue", async () => {
    const run = await runClanMap(deps((url) => (url.pathname === "/clanmap/changes" && url.searchParams.get("since") !== "0" ? { status: 500 } : undefined)));
    expect(run.errors[0]).toContain("HTTP 500");
    const log = parseEventLog(readFileSync(join(cache, "events.bin")));
    expect(log?.length).toBe(2);
    calls = [];
    expect((await runClanMap(deps())).updated).toBe(true);
    expect(calls.filter((c) => c.includes("/changes"))[0]).toContain("since=2");
    expect(film().events).toBe(4);
  });

  it("retélécharge un historique local abîmé", async () => {
    await runClanMap(deps());
    writeFileSync(join(cache, "events.bin"), Buffer.alloc(7));
    now = new Date("2026-11-06T10:00:00.000Z");
    expect((await runClanMap(deps())).updated).toBe(true);
    expect(film().events).toBe(4);
  });

  it("note l'absence de GAL sans inventer de chiffre", async () => {
    const others: Event[] = [["1", 0, 0, "9"]];
    history = others;
    const run = await runClanMap(
      deps((url) =>
        url.pathname === "/clanmap/changes"
          ? { body: { seq: "1", changes: url.searchParams.get("since") === "0" ? others : [], clans: { "9": CLANS["9"] } } }
          : url.pathname === "/clanmap/ownership"
            ? { body: { ...ownershipOf(others), clans: [{ id: "9", ...CLANS["9"] }] } }
            : undefined,
      ),
    );
    expect(run.errors).toEqual([]);
    expect(film().gal).toBeNull();
    expect(film().galSummary).toBeNull();
  });

  it("n'accepte pas un historique local dans le désordre", () => {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32LE(5, 0);
    bytes.writeUInt32LE(5, 12);
    expect(parseEventLog(bytes)).toBeNull();
    expect(parseEventLog(new Uint8Array(0))?.length).toBe(0);
  });
});
