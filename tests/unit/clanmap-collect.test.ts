import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEventLog, runClanMap, type ClanMapDeps } from "../../src/lib/clanmap/collect";
import { TERRAIN_PATH } from "../../src/lib/clanmap/terrain";
import { Meta, StoredClanMapFilm } from "../../src/lib/schemas";

const WIDTH = 8;
const HEIGHT = 4;
const PAGE = 5_000;
const RECORD_BYTES = 16;
const MAP = { width: WIDTH, height: HEIGHT, land: WIDTH * HEIGHT };

/** [numéro, x, y, clan], sans l'ancien propriétaire ni la date : `toApi` les ajoute. */
type Raw = [number, number, number, number];
type ApiEvent = [string, number, number, string, string, number];

const HISTORY: Raw[] = [
  [1, 0, 0, 9],
  [2, 1, 0, 43],
  [4, 0, 0, 43], // Les numéros ont des trous, comme dans la vraie API.
  [5, 2, 0, 9],
];
const CLANS = {
  "9": { tag: "ITA", name: "Italy", color: 0x112233 },
  "43": { tag: "GAL", name: "Les Gaulois", color: 0x38bdf8 },
};

/** Les événements au format de l'API, avec le vrai ancien propriétaire de chaque pixel. */
function toApi(events: Raw[]): ApiEvent[] {
  const owners = new Map<number, number>();
  return events.map(([seq, x, y, clan]) => {
    const pixel = y * WIDTH + x;
    const previous = owners.get(pixel) ?? 0;
    owners.set(pixel, clan);
    return [String(seq), x, y, String(clan), String(previous), 1_793_298_352_135 + seq];
  });
}

/** Une page, comme l'API : `after` exclu, `next` à `null` sur une page courte. */
function pageOf(events: ApiEvent[], after: number) {
  const page = events.filter((e) => Number(e[0]) > after).slice(0, PAGE);
  return { events: page, clans: CLANS, next: page.length === PAGE ? (page.at(-1)?.[0] ?? null) : null };
}

/** Un historique long, pour traverser plusieurs pages. */
function longHistory(length: number): Raw[] {
  return Array.from({ length }, (_, i): Raw => [i + 1, i % WIDTH, (i >> 3) % HEIGHT, i % 7 === 0 ? 43 : 9]);
}

type Route = (url: URL) => { status?: number; body?: unknown; bytes?: Uint8Array } | undefined;

describe("collecte de la carte", () => {
  let dir: string;
  let cache: string;
  let calls: string[];
  let hosts: string[];
  let now: Date;
  let history: Raw[];

  const healthy: Route = (url) => {
    if (url.pathname === TERRAIN_PATH) return { bytes: Buffer.alloc(WIDTH * HEIGHT, 128) };
    if (url.pathname === "/public/clanmap/history") return { body: pageOf(toApi(history), Number(url.searchParams.get("after"))) };
    if (url.pathname === "/clans/GAL") return { body: { tag: "GAL", softBalance: "19279", hardBalance: "878", troops: 8000, memberCount: 760 } };
    return { status: 404 };
  };
  const isHistory = (url: URL) => url.pathname === "/public/clanmap/history";
  const isTerrain = (url: URL) => url.pathname === TERRAIN_PATH;

  const deps = (route: Route = () => undefined, extra: Partial<ClanMapDeps> = {}): ClanMapDeps => ({
    memberGamesFile: "inutile-ici.json",
    fetch: (async (input: string) => {
      const url = new URL(input);
      calls.push(url.pathname + url.search);
      hosts.push(url.hostname);
      const r = route(url) ?? healthy(url);
      return new Response(r?.bytes ? Buffer.from(r.bytes) : JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
    }) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => now,
    dataDir: dir,
    cacheDir: cache,
    map: MAP,
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
    hosts = [];
    now = new Date("2026-11-05T10:00:00.000Z");
    history = [...HISTORY];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("écrit le film et les chiffres de GAL", async () => {
    const run = await runClanMap(deps());
    expect(run).toEqual({ errors: [], updated: true });
    const f = film();
    expect(f).toMatchObject({ version: 3, seq: 5, events: 4, land: WIDTH * HEIGHT, claimed: 3, cols: 4, rows: 2 });
    expect(f.check).toEqual({ events: 4, mismatches: 0 });
    expect(f.galSummary).toMatchObject({ pixels: 2, rank: 1, firstEvent: 2, taken: 2, lost: 0, neutralTaken: 1 });
    // ITA a un pixel en (2, 0), au contact de GAL en (1, 0).
    expect(f.galSummary?.fronts).toEqual([{ tag: "ITA", clan: 1, taken: 1, lost: 0, border: 1, at: [1, 0] }]);
    expect(f.galSummary).toMatchObject({ zoneCount: 1, neutralBorder: 2 });
    expect(f.galSummary?.zones[0]).toMatchObject({ pixels: 2 });
    expect(f.standings).toEqual([
      { tag: "GAL", color: CLANS["43"].color, pixels: 2 },
      { tag: "ITA", color: CLANS["9"].color, pixels: 1 },
    ]);
    expect(f.treasury).toEqual({ caps: 19279, troops: 8000, members: 760 });
    expect(existsSync(join(dir, "clanmap", "film.bin"))).toBe(true);
    expect(meta().clanmap.lastSuccessAt).toBe(now.toISOString());
  });

  it("ne lit que la route documentée, le terrain du dépôt public et la fiche du clan", async () => {
    await runClanMap(deps());
    expect(calls).toEqual(["/public/clanmap/history?after=0", TERRAIN_PATH, "/clans/GAL"]);
    expect(hosts).toEqual(["api.openfront.io", "raw.githubusercontent.com", "api.openfront.io"]);
  });

  it("garde le terrain en cache et ne le relit pas", async () => {
    await runClanMap(deps());
    expect(statSync(join(cache, "terrain.bin")).size).toBe(WIDTH * HEIGHT);
    calls = [];
    now = new Date("2026-11-06T10:00:00.000Z");
    await runClanMap(deps());
    expect(calls).not.toContain(TERRAIN_PATH);
    expect(film().galSummary?.neutralBorder).toBe(2);
  });

  it("garde le film si le terrain est indisponible, sans inventer de chiffre", async () => {
    const run = await runClanMap(deps((url) => (isTerrain(url) ? { status: 404 } : undefined)));
    expect(run).toEqual({ errors: [], updated: true });
    expect(film().galSummary).toMatchObject({ pixels: 2, neutralBorder: null });
    expect(existsSync(join(cache, "terrain.bin"))).toBe(false);
  });

  it("n'utilise ni ne garde un terrain de la mauvaise taille", async () => {
    const run = await runClanMap(deps((url) => (isTerrain(url) ? { bytes: Buffer.alloc(3, 128) } : undefined)));
    expect(run.updated).toBe(true);
    expect(film().galSummary?.neutralBorder).toBeNull();
    expect(existsSync(join(cache, "terrain.bin"))).toBe(false);
  });

  it("n'utilise ni ne garde un terrain qui n'a pas la surface de terre attendue", async () => {
    const run = await runClanMap(deps((url) => (isTerrain(url) ? { bytes: Buffer.alloc(WIDTH * HEIGHT, 0) } : undefined)));
    expect(run.updated).toBe(true);
    expect(film().galSummary?.neutralBorder).toBeNull();
    expect(existsSync(join(cache, "terrain.bin"))).toBe(false);
  });

  it("relit le terrain si celui du cache est abîmé", async () => {
    await runClanMap(deps());
    writeFileSync(join(cache, "terrain.bin"), Buffer.alloc(5));
    calls = [];
    now = new Date("2026-11-06T10:00:00.000Z");
    await runClanMap(deps());
    expect(calls).toContain(TERRAIN_PATH);
    expect(statSync(join(cache, "terrain.bin")).size).toBe(WIDTH * HEIGHT);
  });

  it("refait sans attendre un film d'un format plus ancien, une seule fois", async () => {
    await runClanMap(deps());
    const old = JSON.parse(readFileSync(join(dir, "clanmap", "film.json"), "utf8"));
    writeFileSync(join(dir, "clanmap", "film.json"), JSON.stringify({ ...old, version: 2 }));
    now = new Date("2026-11-05T11:00:00.000Z");
    expect((await runClanMap(deps())).updated).toBe(true);
    expect(film().version).toBe(3);
    now = new Date("2026-11-05T12:00:00.000Z");
    expect((await runClanMap(deps())).updated).toBe(false);
  });

  it("lit un film d'avant la terre neutre sans inventer de chiffre", async () => {
    await runClanMap(deps());
    const old = JSON.parse(readFileSync(join(dir, "clanmap", "film.json"), "utf8"));
    delete old.galSummary.neutralBorder;
    expect(StoredClanMapFilm.parse({ ...old, version: 2 }).galSummary?.neutralBorder).toBeNull();
  });

  it("ne garde aucun identifiant de joueur, ni le plutonium, ni les noms des clans, ni les dates", async () => {
    await runClanMap(deps());
    const raw = readFileSync(join(dir, "clanmap", "film.json"), "utf8");
    expect(raw).not.toContain("publicId");
    expect(raw).not.toContain("878");
    expect(raw).not.toContain("Les Gaulois");
    expect(raw).not.toContain("179329835");
  });

  it("garde le film si la fiche du clan est indisponible, sans inventer de trésor", async () => {
    const run = await runClanMap(deps((url) => (url.pathname === "/clans/GAL" ? { status: 403 } : undefined)));
    expect(run).toEqual({ errors: [], updated: true });
    expect(film().treasury).toBeNull();
    const journal = JSON.parse(readFileSync(join(dir, "clanmap", "journal.json"), "utf8"));
    expect(journal[0]).toMatchObject({ pixels: 2, caps: null, troops: null });
  });

  it("n'invente pas les réserves que la fiche ne donne pas", async () => {
    await runClanMap(deps((url) => (url.pathname === "/clans/GAL" ? { body: { tag: "GAL" } } : undefined)));
    expect(film().treasury).toEqual({ caps: null, troops: null, members: null });
  });

  it("tient un journal d'un relevé par jour, sans réécrire les jours passés", async () => {
    await runClanMap(deps());
    history.push([7, 3, 0, 43]);
    now = new Date("2026-11-05T22:00:00.000Z");
    await runClanMap(deps(undefined, { force: true }));
    now = new Date("2026-11-07T10:00:00.000Z");
    history.push([8, 4, 0, 43]);
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

  it("suit `next` d'une page à l'autre", async () => {
    history = longHistory(PAGE * 2 + 3);
    await runClanMap(deps());
    expect(calls.filter((c) => c.includes("/history"))).toEqual([
      "/public/clanmap/history?after=0",
      `/public/clanmap/history?after=${PAGE}`,
      `/public/clanmap/history?after=${PAGE * 2}`,
    ]);
    expect(film()).toMatchObject({ seq: PAGE * 2 + 3, events: PAGE * 2 + 3, check: { mismatches: 0 } });
  });

  it("reprend après la dernière page complète, pour rester sur les pages en cache chez OpenFront", async () => {
    history = longHistory(PAGE + 3);
    await runClanMap(deps());
    history.push([PAGE + 10, 3, 0, 43], [PAGE + 11, 1, 1, 0]);
    calls = [];
    now = new Date("2026-11-06T10:00:00.000Z");
    await runClanMap(deps());
    expect(calls.filter((c) => c.includes("/history"))).toEqual([`/public/clanmap/history?after=${PAGE}`]);
    expect(film()).toMatchObject({ seq: PAGE + 11, events: PAGE + 5, check: { mismatches: 0 } });
    // La page courte relue n'a pas été écrite en double.
    expect(statSync(join(cache, "events.bin")).size).toBe((PAGE + 5) * RECORD_BYTES);
  });

  it("garde le dernier film valide et signale la panne", async () => {
    await runClanMap(deps());
    const before = readFileSync(join(dir, "clanmap", "film.json"), "utf8");
    now = new Date("2026-11-06T10:00:00.000Z");
    const run = await runClanMap(deps((url) => (isHistory(url) ? { status: 403 } : undefined)));
    expect(run.updated).toBe(false);
    expect(run.errors[0]).toContain("HTTP 403");
    expect(readFileSync(join(dir, "clanmap", "film.json"), "utf8")).toBe(before);
    expect(meta().clanmap.lastError).toContain("HTTP 403");
    expect(meta().clanmap.lastSuccessAt).toBe("2026-11-05T10:00:00.000Z");
  });

  it("refuse de publier un film qui contredit l'ancien propriétaire annoncé", async () => {
    const wrong = toApi(HISTORY);
    wrong[2]![4] = "43"; // Ce pixel appartenait au clan 9, pas à GAL.
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: wrong, clans: CLANS, next: null } } : undefined)));
    expect(run.errors[0]).toContain("1 événements");
    expect(existsSync(join(dir, "clanmap", "film.json"))).toBe(false);
    expect(meta().clanmap.lastSuccessAt).toBeNull();
  });

  it("repère un événement manquant dans l'historique", async () => {
    // Sans l'événement n° 1, GAL semble prendre une terre neutre alors que le pixel est annoncé au clan 9.
    const holed = toApi(HISTORY).filter((e) => e[0] !== "1");
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: holed, clans: CLANS, next: null } } : undefined)));
    expect(run.errors[0]).toContain("contredit");
    expect(existsSync(join(dir, "clanmap", "film.json"))).toBe(false);
  });

  it("refuse un événement hors de la carte sans l'ajouter à l'historique", async () => {
    const outside: ApiEvent = ["1", WIDTH, 0, "9", "0", 1];
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: [outside], clans: CLANS, next: null } } : undefined)));
    expect(run.errors[0]).toContain("hors de la carte");
    expect(existsSync(join(cache, "events.bin"))).toBe(false);
  });

  it("refuse un événement qui remonte le temps", async () => {
    const events: ApiEvent[] = [["2", 0, 0, "9", "0", 1], ["2", 1, 0, "9", "0", 2]];
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events, clans: CLANS, next: null } } : undefined)));
    expect(run.errors[0]).toContain("hors d'ordre");
  });

  it("s'arrête si `next` n'avance pas, au lieu de tourner sans fin", async () => {
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: toApi(HISTORY), clans: CLANS, next: "0" } } : undefined)));
    expect(run.errors[0]).toContain("n'avance pas");
    expect(calls.filter((c) => c.includes("/history"))).toHaveLength(1);
  });

  it("ignore une réponse invalide", async () => {
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: "cassé", next: null } } : undefined)));
    expect(run.errors[0]).toContain("réponse invalide");
    expect(existsSync(join(dir, "clanmap", "film.json"))).toBe(false);
  });

  it("signale un historique vide sans écrire de film", async () => {
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: [], clans: {}, next: null } } : undefined)));
    expect(run.errors[0]).toContain("vide");
    expect(existsSync(join(dir, "clanmap", "film.json"))).toBe(false);
  });

  it("conserve les pages déjà lues si la suite échoue", async () => {
    history = longHistory(PAGE + 2);
    const run = await runClanMap(deps((url) => (isHistory(url) && url.searchParams.get("after") !== "0" ? { status: 500 } : undefined)));
    expect(run.errors[0]).toContain("HTTP 500");
    expect(parseEventLog(readFileSync(join(cache, "events.bin")))?.length).toBe(PAGE);
    calls = [];
    expect((await runClanMap(deps())).updated).toBe(true);
    expect(calls.filter((c) => c.includes("/history"))[0]).toContain(`after=${PAGE}`);
    expect(film().events).toBe(PAGE + 2);
  });

  it("retélécharge un historique local abîmé", async () => {
    await runClanMap(deps());
    writeFileSync(join(cache, "events.bin"), Buffer.alloc(7));
    now = new Date("2026-11-06T10:00:00.000Z");
    expect((await runClanMap(deps())).updated).toBe(true);
    expect(film().events).toBe(4);
  });

  it("n'accepte pas un historique local de l'ancien format, sans l'ancien propriétaire", () => {
    // Quatre événements de 12 octets : 48 octets, soit aussi un nombre entier d'enregistrements actuels.
    const old = Buffer.alloc(48);
    HISTORY.forEach(([seq, x, y, clan], i) => {
      old.writeUInt32LE(seq, i * 12);
      old.writeUInt16LE(x, i * 12 + 4);
      old.writeUInt16LE(y, i * 12 + 6);
      old.writeUInt32LE(clan, i * 12 + 8);
    });
    expect(parseEventLog(old)).toBeNull();
  });

  it("note l'absence de GAL sans inventer de chiffre", async () => {
    const others = toApi([[1, 0, 0, 9]]);
    const run = await runClanMap(deps((url) => (isHistory(url) ? { body: { events: others, clans: { "9": CLANS["9"] }, next: null } } : undefined)));
    expect(run.errors).toEqual([]);
    expect(film().gal).toBeNull();
    expect(film().galSummary).toBeNull();
  });

  it("n'accepte pas un historique local dans le désordre", () => {
    const bytes = Buffer.alloc(RECORD_BYTES * 2);
    bytes.writeUInt32LE(5, 0);
    bytes.writeUInt32LE(5, RECORD_BYTES);
    expect(parseEventLog(bytes)).toBeNull();
    expect(parseEventLog(new Uint8Array(0))?.length).toBe(0);
  });
});
