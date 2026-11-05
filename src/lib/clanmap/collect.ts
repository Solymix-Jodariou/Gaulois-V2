/**
 * Collecte de la carte officielle des clans, une fois par jour.
 *
 * L'historique brut reste hors de Git, dans `cacheDir` : il pèse plusieurs dizaines
 * de mégaoctets et grossit vite. Perdu, il se retélécharge entièrement. Seul le film
 * compilé est écrit dans `data/clanmap/`, et seulement si le rejeu retombe
 * exactement sur la carte du jeu.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { z } from "zod";
import { encodeFrames } from "./codec";
import { enemyPixelCost } from "./economy";
import { analyzeTerritory, decodeOwnership, replayHistory, type EventLog } from "./replay";
import { countLand, terrainToRgb } from "./terrain";
import { API_ORIGIN, ApiClient, markError, markOk, readJson, writeJson, type Deps } from "../pipeline";
import { ApiClanCard, ApiClanMapChanges, ApiClanMapOwnership, ClanMapJournal, Meta, StoredClanMapFilm, emptyMeta } from "../schemas";
import { parisParts } from "../time";

const SCALE = 2;
const RECORD_BYTES = 12;
const MIN_INTERVAL_MS = 20 * 3_600_000;
/** Une seule exécution ne télécharge pas tout : la suite reprendra au passage suivant. */
const MAX_PAGES_PER_RUN = 1_500;
const PAGE_SIZE = 5_000;

const ClanDirectory = z.record(z.string(), z.object({ tag: z.string(), color: z.number().int().nullable() }));
type ClanDirectory = z.infer<typeof ClanDirectory>;

export interface ClanMapDeps extends Deps {
  cacheDir: string;
  /** Ignore le délai d'une journée entre deux mises à jour. */
  force?: boolean;
}

/** Relit l'historique local. Un fichier abîmé renvoie `null` : il sera retéléchargé. */
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
  }
  return log;
}

function encodeRecords(changes: readonly (readonly [string, number, number, string, ...unknown[]])[]): Buffer {
  const out = Buffer.alloc(changes.length * RECORD_BYTES);
  changes.forEach(([seq, x, y, clan], i) => {
    const o = i * RECORD_BYTES;
    out.writeUInt32LE(Number(seq), o);
    out.writeUInt16LE(x, o + 4);
    out.writeUInt16LE(y, o + 6);
    out.writeUInt32LE(Number(clan), o + 8);
  });
  return out;
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

/** Renvoie le terrain, gardé dans le cache, et écrit le fond de carte s'il manque. */
async function ensureTerrain(api: ApiClient, deps: ClanMapDeps, dir: string, width: number, height: number): Promise<Uint8Array> {
  const cached = join(deps.cacheDir, "terrain.bin");
  let terrain: Uint8Array | null = existsSync(cached) ? await readFile(cached) : null;
  if (!terrain || terrain.length !== width * height) {
    const raw = await api.getBytes("/clanmap/terrain", API_ORIGIN);
    terrain = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
    if (terrain.length !== width * height) throw new Error(`terrain de ${terrain.length} cases pour ${width * height} attendues`);
    await writeBytes(cached, terrain);
  }
  const file = join(dir, "terrain.webp");
  if (!existsSync(file)) {
    const image = terrainToRgb(terrain, width, height, SCALE);
    await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).webp({ quality: 82 }).toFile(`${file}.tmp`);
    await rename(`${file}.tmp`, file);
  }
  return terrain;
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

/** Complète l'historique local. Chaque page lue est conservée, même si la suite échoue. */
async function downloadHistory(api: ApiClient, deps: ClanMapDeps, width: number, height: number, target: number, clans: ClanDirectory): Promise<number> {
  const logPath = join(deps.cacheDir, "events.bin");
  let lastSeq = 0;
  if (existsSync(logPath)) {
    const log = parseEventLog(await readFile(logPath));
    if (log) lastSeq = log.length > 0 ? log.seq[log.length - 1]! : 0;
    else {
      deps.log("carte : historique local abîmé, nouveau téléchargement complet");
      await rm(logPath);
    }
  }
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES_PER_RUN) throw new Error(`historique incomplet après ${page} pages, reprise au prochain passage`);
    const res = await api.get(`/clanmap/changes?since=${lastSeq}`, ApiClanMapChanges, API_ORIGIN);
    if (res.changes.length === 0) break;
    let previous = lastSeq;
    for (const [seq, x, y] of res.changes) {
      if (Number(seq) <= previous) throw new Error(`événement ${seq} hors d'ordre`);
      if (x >= width || y >= height) throw new Error(`événement ${seq} hors de la carte`);
      previous = Number(seq);
    }
    for (const [id, clan] of Object.entries(res.clans)) clans[id] = { tag: clan.tag, color: clan.color ?? null };
    await appendFile(logPath, encodeRecords(res.changes));
    lastSeq = previous;
    if (res.changes.length < PAGE_SIZE && lastSeq >= target) break;
  }
  return lastSeq;
}

async function updateClanMap(api: ApiClient, deps: ClanMapDeps, at: string): Promise<StoredClanMapFilm> {
  const dir = join(deps.dataDir, "clanmap");
  await mkdir(dir, { recursive: true });
  await mkdir(deps.cacheDir, { recursive: true });

  // L'instantané d'abord : l'historique lu ensuite va forcément au moins jusqu'à lui.
  const ownership = await api.get("/clanmap/ownership", ApiClanMapOwnership, API_ORIGIN);
  const { width, height } = ownership;
  const snapshot = {
    seq: Number(ownership.seq),
    grid: decodeOwnership(Buffer.from(ownership.rle, "base64"), width * height),
    clanIds: ownership.clans.map((c) => Number(c.id)),
  };

  const directoryPath = join(deps.cacheDir, "clans.json");
  const clans: ClanDirectory = (await readJson(directoryPath, ClanDirectory)) ?? {};
  try {
    await downloadHistory(api, deps, width, height, snapshot.seq, clans);
  } finally {
    await writeJson(directoryPath, clans);
  }
  for (const c of ownership.clans) clans[c.id] = { tag: c.tag, color: c.color ?? null };
  await writeJson(directoryPath, clans);

  const log = parseEventLog(await readFile(join(deps.cacheDir, "events.bin")));
  if (!log || log.length === 0) throw new Error("historique de la carte vide ou abîmé");

  const galEntry = Object.entries(clans).find(([, c]) => c.tag === deps.tag);
  const result = replayHistory(log, { width, height, scale: SCALE, galId: galEntry ? Number(galEntry[0]) : null, snapshot });
  if (!result.check) throw new Error(`historique arrêté avant l'instantané ${snapshot.seq}`);
  if (result.check.mismatches > 0) {
    throw new Error(`le rejeu diffère de la carte du jeu sur ${result.check.mismatches} pixels`);
  }

  const terrain = await ensureTerrain(api, deps, dir, width, height);
  const card = await fetchClanCard(api, deps);

  const clanAt = (index: number) => {
    const entry = clans[String(result.clanIds[index])];
    return { tag: entry?.tag ?? null, color: entry?.color ?? null };
  };
  const order = [...result.pixels.keys()].filter((i) => i > 0 && result.pixels[i]! > 0).sort((a, b) => result.pixels[b]! - result.pixels[a]! || a - b);
  const troopsById = new Map(ownership.clans.map((c) => [Number(c.id), c.troops ?? null]));
  const troopsAt = (index: number) => troopsById.get(result.clanIds[index]!) ?? null;
  const analysis = result.gal !== null && result.galSummary ? analyzeTerritory(result.grid, width, height, SCALE, result.gal, terrain) : null;
  const myTroops = result.gal === null ? null : troopsAt(result.gal);
  const treasury =
    card || myTroops !== null
      ? {
          caps: card?.softBalance === undefined ? null : Number(card.softBalance),
          troops: card?.troops ?? myTroops,
          members: card?.memberCount ?? null,
        }
      : null;
  const film: StoredClanMapFilm = {
    version: 1,
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
    land: countLand(terrain),
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
              const pixels = result.pixels[f.clan]!;
              return {
                tag: clanAt(f.clan).tag,
                clan: f.clan,
                taken: f.taken,
                lost: f.lost,
                border: border?.pixels ?? 0,
                at: border ? ([border.x, border.y] as [number, number]) : null,
                pixelCost: pixels > 0 ? enemyPixelCost(troopsAt(f.clan), pixels) : null,
              };
            }),
            zones: analysis.zones,
            zoneCount: analysis.zoneCount,
            neutralBorder: analysis.neutralBorder,
          }
        : null,
    standings: order.map((i) => ({ ...clanAt(i), pixels: result.pixels[i]!, troops: troopsAt(i) })),
    treasury,
    frames: result.frames,
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

/** Un échec garde le dernier film valide et se note dans `meta.json`. */
export async function runClanMap(deps: ClanMapDeps): Promise<ClanMapRun> {
  const metaPath = join(deps.dataDir, "meta.json");
  const meta = (await readJson(metaPath, Meta)) ?? emptyMeta();
  const last = meta.clanmap.lastSuccessAt ? Date.parse(meta.clanmap.lastSuccessAt) : 0;
  if (!deps.force && deps.now().getTime() - last < MIN_INTERVAL_MS) return { errors: [], updated: false };

  const at = deps.now().toISOString();
  const errors: string[] = [];
  let updated = false;
  try {
    const film = await updateClanMap(new ApiClient(deps), deps, at);
    markOk(meta.clanmap, at);
    updated = true;
    deps.log(`carte : ${film.events} événements, ${film.frames.length} images, contrôle à ${film.check.mismatches} pixel d'écart`);
  } catch (e) {
    const msg = markError(meta.clanmap, at, e);
    errors.push(`carte : ${msg}`);
    deps.log(`ÉCHEC carte : ${msg}`);
  }
  await writeJson(metaPath, meta);
  return { errors, updated };
}
