/**
 * Collecte de la carte officielle des clans, une fois par jour.
 *
 * L'historique vient de `/public/clanmap/history`, la route documentée par OpenFront
 * pour construire ce genre de film, et le terrain du dépôt public du jeu. Ils restent
 * hors de Git, dans `cacheDir` : l'historique pèse plusieurs dizaines de mégaoctets et
 * grossit vite. Perdus, ils se retéléchargent entièrement. Seul le film compilé est écrit
 * dans `data/clanmap/`, et seulement si le rejeu retombe sur l'ancien propriétaire
 * annoncé par chaque événement.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { encodeFrames } from "./codec";
import { analyzeTerritory, replayHistory, type EventLog } from "./replay";
import { OFFICIAL_MAP, TERRAIN_ORIGIN, TERRAIN_PATH, countLand } from "./terrain";
import { API_ORIGIN, ApiClient, markError, markOk, readJson, writeJson, type Deps } from "../pipeline";
import { ApiClanCard, ApiClanMapHistory, ClanMapJournal, Meta, StoredClanMapFilm, emptyMeta } from "../schemas";
import { parisParts } from "../time";

const FILM_VERSION = 4;
const SCALE = 2;
/** Numéro, x, y, clan, ancien clan, puis la date en secondes Unix. */
const RECORD_BYTES = 20;
/**
 * La carte n'existait pas avant 2020. Une date plus ancienne trahit un fichier d'un autre format :
 * lu avec 20 octets par événement, l'ancien format donnerait pour date le numéro de l'événement suivant.
 */
const EARLIEST_EVENT_SECONDS = 1_577_836_800;
/** Un petit décalage d'horloge est toléré, pas une date franchement dans le futur. */
const FUTURE_TOLERANCE_MS = 86_400_000;
const MIN_INTERVAL_MS = 20 * 3_600_000;
/** Une seule exécution ne télécharge pas tout : la suite reprendra au passage suivant. */
const MAX_PAGES_PER_RUN = 1_500;
/** La taille par défaut d'une page : la documentation la demande, car ces pages sont en cache chez OpenFront. */
const PAGE_SIZE = 5_000;

const ClanDirectory = z.record(z.string(), z.object({ tag: z.string(), color: z.number().int().nullable() }));
type ClanDirectory = z.infer<typeof ClanDirectory>;

export interface ClanMapDeps extends Deps {
  cacheDir: string;
  /** Ignore le délai d'une journée entre deux mises à jour. */
  force?: boolean;
  /** La carte à rejouer. Par défaut, la carte officielle. */
  map?: typeof OFFICIAL_MAP;
}

/** Relit l'historique local. Un fichier abîmé, ou d'un ancien format, renvoie `null` : il sera retéléchargé. */
export function parseEventLog(bytes: Uint8Array): EventLog | null {
  if (bytes.length % RECORD_BYTES !== 0) return null;
  const length = bytes.length / RECORD_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const log: EventLog = {
    length,
    seq: new Uint32Array(length),
    x: new Uint16Array(length),
    y: new Uint16Array(length),
    clan: new Uint32Array(length),
    previous: new Uint32Array(length),
    at: new Uint32Array(length),
  };
  let last = 0;
  for (let i = 0; i < length; i++) {
    const o = i * RECORD_BYTES;
    const seq = view.getUint32(o, true);
    if (seq <= last) return null;
    last = seq;
    log.seq[i] = seq;
    log.x[i] = view.getUint16(o + 4, true);
    log.y[i] = view.getUint16(o + 6, true);
    log.clan[i] = view.getUint32(o + 8, true);
    log.previous[i] = view.getUint32(o + 12, true);
    const at = view.getUint32(o + 16, true);
    if (at < EARLIEST_EVENT_SECONDS) return null;
    log.at[i] = at;
  }
  return log;
}

function encodeRecords(events: readonly (readonly [string, number, number, string, string, number, ...unknown[]])[]): Buffer {
  const out = Buffer.alloc(events.length * RECORD_BYTES);
  events.forEach(([seq, x, y, clan, previous, createdAt], i) => {
    const o = i * RECORD_BYTES;
    out.writeUInt32LE(Number(seq), o);
    out.writeUInt16LE(x, o + 4);
    out.writeUInt16LE(y, o + 6);
    out.writeUInt32LE(Number(clan), o + 8);
    out.writeUInt32LE(Number(previous), o + 12);
    out.writeUInt32LE(Math.floor(createdAt / 1000), o + 16);
  });
  return out;
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

/** Le trésor est un plus : sans lui, le film reste valable et la page écrit « pas de données ». */
async function fetchClanCard(api: ApiClient, deps: ClanMapDeps): Promise<z.output<typeof ApiClanCard> | null> {
  try {
    return await api.get(`/clans/${deps.tag}`, ApiClanCard, API_ORIGIN);
  } catch (e) {
    deps.log(`carte : fiche du clan indisponible (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

/**
 * Le terrain, gardé dans le cache. Il sert à reconnaître la terre : sans lui, le film
 * reste valable et la page n'affiche pas ce chiffre. Un fichier qui ne donne pas la
 * surface de terre attendue n'est ni utilisé ni gardé.
 */
async function loadTerrain(api: ApiClient, deps: ClanMapDeps, map: typeof OFFICIAL_MAP): Promise<Uint8Array | null> {
  const path = join(deps.cacheDir, "terrain.bin");
  const matches = (bytes: Uint8Array) => bytes.length === map.width * map.height && countLand(bytes) === map.land;
  try {
    if (existsSync(path)) {
      const cached = await readFile(path);
      if (matches(cached)) return cached;
    }
    const terrain = await api.getBytes(TERRAIN_PATH, TERRAIN_ORIGIN);
    if (!matches(terrain)) throw new Error("taille ou surface de terre inattendue");
    await writeBytes(path, terrain);
    return terrain;
  } catch (e) {
    deps.log(`carte : terrain indisponible (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

/** Où reprendre : après la dernière page complète, pour rester sur les pages en cache chez OpenFront. */
async function resumePoint(logPath: string, deps: ClanMapDeps): Promise<number> {
  if (!existsSync(logPath)) return 0;
  const log = parseEventLog(await readFile(logPath));
  if (!log) {
    deps.log("carte : historique local abîmé ou d'un ancien format, nouveau téléchargement complet");
    await rm(logPath);
    return 0;
  }
  const kept = log.length - (log.length % PAGE_SIZE);
  if (kept < log.length) await truncate(logPath, kept * RECORD_BYTES);
  return kept > 0 ? log.seq[kept - 1]! : 0;
}

/** Complète l'historique local. Chaque page lue est conservée, même si la suite échoue. */
async function downloadHistory(api: ApiClient, deps: ClanMapDeps, width: number, height: number, clans: ClanDirectory): Promise<void> {
  const logPath = join(deps.cacheDir, "events.bin");
  let after = await resumePoint(logPath, deps);
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES_PER_RUN) throw new Error(`historique incomplet après ${page} pages, reprise au prochain passage`);
    const res = await api.get(`/clanmap/history?after=${after}`, ApiClanMapHistory);
    let lastSeq = after;
    const latestDate = deps.now().getTime() + FUTURE_TOLERANCE_MS;
    for (const [seq, x, y, , , createdAt] of res.events) {
      if (Number(seq) <= lastSeq) throw new Error(`événement ${seq} hors d'ordre`);
      if (x >= width || y >= height) throw new Error(`événement ${seq} hors de la carte`);
      if (createdAt < EARLIEST_EVENT_SECONDS * 1000 || createdAt > latestDate) throw new Error(`événement ${seq} avec une date impossible`);
      lastSeq = Number(seq);
    }
    for (const [id, clan] of Object.entries(res.clans)) clans[id] = { tag: clan.tag, color: clan.color ?? null };
    if (res.events.length > 0) await appendFile(logPath, encodeRecords(res.events));
    if (res.next === null || res.events.length === 0) return;
    // La documentation demande de suivre `next` plutôt que de compter : les numéros ont des trous.
    if (Number(res.next) <= after) throw new Error(`page suivante ${res.next} qui n'avance pas après ${after}`);
    after = Number(res.next);
  }
}

async function updateClanMap(api: ApiClient, deps: ClanMapDeps, at: string): Promise<StoredClanMapFilm> {
  const map = deps.map ?? OFFICIAL_MAP;
  const { width, height, land } = map;
  const dir = join(deps.dataDir, "clanmap");
  await mkdir(dir, { recursive: true });
  await mkdir(deps.cacheDir, { recursive: true });

  const directoryPath = join(deps.cacheDir, "clans.json");
  const clans: ClanDirectory = (await readJson(directoryPath, ClanDirectory)) ?? {};
  try {
    await downloadHistory(api, deps, width, height, clans);
  } finally {
    await writeJson(directoryPath, clans);
  }

  const logPath = join(deps.cacheDir, "events.bin");
  const log = existsSync(logPath) ? parseEventLog(await readFile(logPath)) : null;
  if (!log || log.length === 0) throw new Error("historique de la carte vide ou abîmé");

  const galEntry = Object.entries(clans).find(([, c]) => c.tag === deps.tag);
  const result = replayHistory(log, { width, height, scale: SCALE, galId: galEntry ? Number(galEntry[0]) : null });
  if (result.check.mismatches > 0) {
    throw new Error(`le rejeu contredit l'historique sur ${result.check.mismatches} événements`);
  }

  const terrain = await loadTerrain(api, deps, map);
  const card = await fetchClanCard(api, deps);

  const clanAt = (index: number) => {
    const entry = clans[String(result.clanIds[index])];
    return { tag: entry?.tag ?? null, color: entry?.color ?? null };
  };
  const order = [...result.pixels.keys()].filter((i) => i > 0 && result.pixels[i]! > 0).sort((a, b) => result.pixels[b]! - result.pixels[a]! || a - b);
  const analysis = result.gal !== null && result.galSummary ? analyzeTerritory(result.grid, width, height, SCALE, result.gal, terrain) : null;
  const treasury = card
    ? {
        caps: card.softBalance === undefined ? null : Number(card.softBalance),
        troops: card.troops ?? null,
        members: card.memberCount ?? null,
      }
    : null;
  const film: StoredClanMapFilm = {
    version: FILM_VERSION,
    fetchedAt: at,
    seq: log.seq[log.length - 1]!,
    events: log.length,
    width,
    height,
    scale: SCALE,
    cols: result.cols,
    rows: result.rows,
    bucket: result.bucket,
    totalChanges: result.deltas.reduce((n, d) => n + d.length / 2, 0),
    land,
    claimed: order.reduce((n, i) => n + result.pixels[i]!, 0),
    check: result.check,
    clans: result.clanIds.map((_, i) => clanAt(i)),
    gal: result.gal,
    galSummary:
      result.galSummary && analysis
        ? {
            ...result.galSummary,
            fronts: result.galSummary.fronts.map((f) => {
              const border = analysis.borders.get(f.clan);
              return {
                tag: clanAt(f.clan).tag,
                clan: f.clan,
                taken: f.taken,
                lost: f.lost,
                border: border?.pixels ?? 0,
                at: border ? ([border.x, border.y] as [number, number]) : null,
              };
            }),
            zones: analysis.zones,
            zoneCount: analysis.zoneCount,
            neutralBorder: analysis.neutralBorder,
          }
        : null,
    standings: order.map((i) => ({ ...clanAt(i), pixels: result.pixels[i]! })),
    treasury,
    frames: result.frames,
    days: result.days,
  };
  await writeBytes(join(dir, "film.bin"), encodeFrames(result.deltas));
  await writeJson(join(dir, "film.json"), film);

  // Le journal garde le dernier relevé de chaque jour, sans jamais le réécrire après coup.
  const journalPath = join(dir, "journal.json");
  const journal = (await readJson(journalPath, ClanMapJournal)) ?? [];
  const date = parisParts(at).date;
  const entry = {
    date,
    pixels: film.galSummary?.pixels ?? 0,
    rank: film.galSummary?.rank ?? null,
    caps: treasury?.caps ?? null,
    troops: treasury?.troops ?? null,
  };
  await writeJson(journalPath, [...journal.filter((e) => e.date !== date), entry]);
  return film;
}

export interface ClanMapRun {
  errors: string[];
  updated: boolean;
}

/** Un film d'un format plus ancien se refait au passage suivant, sans attendre le délai d'une journée. */
async function filmIsOutdated(deps: ClanMapDeps): Promise<boolean> {
  const stored = await readJson(join(deps.dataDir, "clanmap", "film.json"), z.object({ version: z.number() }));
  return stored !== null && stored.version < FILM_VERSION;
}

/** Un échec garde le dernier film valide et se note dans `meta.json`. */
export async function runClanMap(deps: ClanMapDeps): Promise<ClanMapRun> {
  const metaPath = join(deps.dataDir, "meta.json");
  const meta = (await readJson(metaPath, Meta)) ?? emptyMeta();
  const last = meta.clanmap.lastSuccessAt ? Date.parse(meta.clanmap.lastSuccessAt) : 0;
  const recent = deps.now().getTime() - last < MIN_INTERVAL_MS;
  if (!deps.force && recent && !(await filmIsOutdated(deps))) return { errors: [], updated: false };

  const at = deps.now().toISOString();
  const errors: string[] = [];
  let updated = false;
  try {
    const film = await updateClanMap(new ApiClient(deps), deps, at);
    markOk(meta.clanmap, at);
    updated = true;
    deps.log(`carte : ${film.events} événements, ${film.frames.length} images, ${film.check.mismatches} écart au contrôle`);
  } catch (e) {
    const msg = markError(meta.clanmap, at, e);
    errors.push(`carte : ${msg}`);
    deps.log(`ÉCHEC carte : ${msg}`);
  }
  await writeJson(metaPath, meta);
  return { errors, updated };
}
