/**
 * Rejoue l'historique de la carte officielle des clans.
 *
 * Tous les chiffres sont calculés sur la carte complète. Seul l'affichage du film
 * est réduit. L'ordre des clans suit le nombre de pixels, comme la liste de la
 * carte officielle : ce n'est pas le classement des clans, qui reste celui de l'API.
 */

/** Taille d'une image du film en événements, doublée quand le film devient trop long. */
export const FRAME_BASE = 5_000;
export const FRAME_MAX = 480;
export const TOP_SIZE = 5;
const FRONTS_KEPT = 8;

/**
 * Une taille stable : les images déjà calculées ne changent pas d'un jour à
 * l'autre, ce qui évite de réécrire tout le fichier dans Git.
 */
export function bucketSize(events: number): number {
  let bucket = FRAME_BASE;
  while (Math.ceil(events / bucket) > FRAME_MAX) bucket *= 2;
  return bucket;
}

export interface EventLog {
  length: number;
  seq: Uint32Array;
  x: Uint16Array;
  y: Uint16Array;
  clan: Uint32Array;
  /** L'ancien propriétaire annoncé par OpenFront. Il permet de contrôler le rejeu. */
  previous: Uint32Array;
}

export interface ReplayOptions {
  width: number;
  height: number;
  scale: number;
  galId: number | null;
}

export interface FilmFrameData {
  ev: number;
  total: number;
  clans: number;
  gal: number;
  rank: number | null;
  top: [number, number][];
  cam: [number, number, number, number] | null;
}

export interface GalReplay {
  pixels: number;
  rank: number | null;
  firstEvent: number;
  peak: { pixels: number; event: number };
  taken: number;
  lost: number;
  neutralTaken: number;
  fronts: { clan: number; taken: number; lost: number }[];
}

export interface ReplayResult {
  /** Identifiant de chaque clan, par ordre d'apparition. L'index 0 est la terre neutre. */
  clanIds: number[];
  gal: number | null;
  frames: FilmFrameData[];
  deltas: number[][];
  bucket: number;
  cols: number;
  rows: number;
  /** Événements dont l'ancien propriétaire annoncé diffère du rejeu. */
  check: { events: number; mismatches: number };
  pixels: Int32Array;
  galSummary: GalReplay | null;
  /** La carte complète à la fin de l'historique. */
  grid: Uint16Array;
}

export interface TerritoryZone {
  pixels: number;
  /** Centre et demi-étendue, en cases du film. */
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface TerritoryAnalysis {
  zones: TerritoryZone[];
  zoneCount: number;
  /** Pour chaque clan voisin : ses pixels au contact, et le centre de sa plus grosse portion de frontière, en cases du film. */
  borders: Map<number, { pixels: number; x: number; y: number }>;
}

const ZONES_KEPT = 5;
/** Une frontière peut être en plusieurs morceaux : on regarde où elle est la plus dense, par carrés de ce côté. */
const FRONT_BIN = 128;

/** Les zones d'un seul tenant d'un clan et ce qui les borde, sur la carte complète. */
export function analyzeTerritory(grid: Uint16Array, width: number, height: number, scale: number, clan: number): TerritoryAnalysis {
  const size = width * height;
  const visited = new Uint8Array(size);
  const counted = new Uint8Array(size);
  const stack = new Int32Array(size);
  const zones: TerritoryZone[] = [];
  let zoneCount = 0;
  const contacts = new Map<number, { pixels: number; bins: Map<number, { n: number; sumX: number; sumY: number }> }>();

  const look = (p: number) => {
    if (counted[p]) return;
    counted[p] = 1;
    const owner = grid[p]!;
    if (owner === 0) return;
    let contact = contacts.get(owner);
    if (!contact) {
      contact = { pixels: 0, bins: new Map() };
      contacts.set(owner, contact);
    }
    contact.pixels++;
    const x = p % width;
    const y = Math.floor(p / width);
    const key = Math.floor(y / FRONT_BIN) * width + Math.floor(x / FRONT_BIN);
    const bin = contact.bins.get(key) ?? { n: 0, sumX: 0, sumY: 0 };
    bin.n++;
    bin.sumX += x;
    bin.sumY += y;
    contact.bins.set(key, bin);
  };

  for (let start = 0; start < size; start++) {
    if (visited[start] || grid[start] !== clan) continue;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;
    let pixels = 0;
    let x0 = width;
    let x1 = 0;
    let y0 = height;
    let y1 = 0;
    while (top > 0) {
      const p = stack[--top]!;
      pixels++;
      const x = p % width;
      const y = Math.floor(p / width);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const n of neighbours) {
        if (n < 0) continue;
        if (grid[n] === clan) {
          if (!visited[n]) {
            visited[n] = 1;
            stack[top++] = n;
          }
        } else {
          look(n);
        }
      }
    }
    zoneCount++;
    zones.push({
      pixels,
      x: Math.round((x0 + x1) / 2 / scale),
      y: Math.round((y0 + y1) / 2 / scale),
      halfWidth: Math.ceil((x1 - x0 + 1) / 2 / scale),
      halfHeight: Math.ceil((y1 - y0 + 1) / 2 / scale),
    });
  }
  zones.sort((a, b) => b.pixels - a.pixels);
  const borders = new Map<number, { pixels: number; x: number; y: number }>();
  for (const [owner, c] of contacts) {
    let densest = { n: 0, sumX: 0, sumY: 0 };
    for (const bin of c.bins.values()) if (bin.n > densest.n) densest = bin;
    borders.set(owner, { pixels: c.pixels, x: Math.round(densest.sumX / densest.n / scale), y: Math.round(densest.sumY / densest.n / scale) });
  }
  return { zones: zones.slice(0, ZONES_KEPT), zoneCount, borders };
}

function rankedClans(pixels: Int32Array): number[] {
  const order: number[] = [];
  for (let i = 1; i < pixels.length; i++) if (pixels[i]! > 0) order.push(i);
  return order.sort((a, b) => pixels[b]! - pixels[a]! || a - b);
}

export function replayHistory(log: EventLog, options: ReplayOptions): ReplayResult {
  const { width, height, scale, galId } = options;
  const size = width * height;
  const cols = Math.floor(width / scale);
  const rows = Math.floor(height / scale);

  const index = new Map<number, number>([[0, 0]]);
  const clanIds: number[] = [0];
  const owners = new Uint16Array(log.length);
  for (let i = 0; i < log.length; i++) {
    const id = log.clan[i]!;
    let at = index.get(id);
    if (at === undefined) {
      at = clanIds.length;
      clanIds.push(id);
      index.set(id, at);
    }
    owners[i] = at;
  }
  const gal = galId === null ? null : (index.get(galId) ?? null);

  const grid = new Uint16Array(size);
  const low = new Uint16Array(cols * rows);
  const pixels = new Int32Array(clanIds.length);
  const taken = new Map<number, number>();
  const lost = new Map<number, number>();
  let firstEvent = 0;
  const peak = { pixels: 0, event: 0 };

  // Centre et étendue de GAL, tenus à jour à chaque case modifiée.
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  const trackCell = (cell: number, sign: 1 | -1) => {
    const x = cell % cols;
    const y = Math.floor(cell / cols);
    n += sign;
    sumX += sign * x;
    sumY += sign * y;
    sumXX += sign * x * x;
    sumYY += sign * y * y;
  };

  const touched = new Set<number>();
  const majority = (cell: number): number => {
    const cx = cell % cols;
    const cy = Math.floor(cell / cols);
    const counts = new Map<number, number>();
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const v = grid[(cy * scale + dy) * width + cx * scale + dx]!;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    let best = 0;
    let bestCount = -1;
    for (const [v, c] of counts) {
      if (c > bestCount || (c === bestCount && v !== 0 && (best === 0 || v < best))) {
        best = v;
        bestCount = c;
      }
    }
    return best;
  };

  const frames: FilmFrameData[] = [];
  const deltas: number[][] = [];
  const bucket = bucketSize(log.length);

  const closeFrame = (event: number) => {
    const delta: number[] = [];
    for (const cell of [...touched].sort((a, b) => a - b)) {
      const v = majority(cell);
      const before = low[cell]!;
      if (v === before) continue;
      if (gal !== null && before === gal) trackCell(cell, -1);
      if (gal !== null && v === gal) trackCell(cell, 1);
      low[cell] = v;
      delta.push(cell, v);
    }
    touched.clear();
    deltas.push(delta);
    const order = rankedClans(pixels);
    const position = gal === null ? -1 : order.indexOf(gal);
    frames.push({
      ev: event,
      total: order.reduce((sum, i) => sum + pixels[i]!, 0),
      clans: order.length,
      gal: gal === null ? 0 : pixels[gal]!,
      rank: position >= 0 ? position + 1 : null,
      top: order.slice(0, TOP_SIZE).map((i) => [i, pixels[i]!] as [number, number]),
      cam:
        n > 0
          ? [
              Math.round(sumX / n),
              Math.round(sumY / n),
              Math.round(Math.sqrt(Math.max(0, sumXX / n - (sumX / n) ** 2))),
              Math.round(Math.sqrt(Math.max(0, sumYY / n - (sumY / n) ** 2))),
            ]
          : null,
    });
  };

  let mismatches = 0;

  for (let i = 0; i < log.length; i++) {
    const x = log.x[i]!;
    const y = log.y[i]!;
    const v = owners[i]!;
    const p = y * width + x;
    const prev = grid[p]!;
    if (clanIds[prev] !== log.previous[i]) mismatches++;
    if (prev !== v) {
      if (prev) pixels[prev]!--;
      if (v) pixels[v]!++;
      grid[p] = v;
      if (gal !== null && v === gal) {
        if (firstEvent === 0) firstEvent = i + 1;
        taken.set(prev, (taken.get(prev) ?? 0) + 1);
        if (pixels[gal]! > peak.pixels) {
          peak.pixels = pixels[gal]!;
          peak.event = i + 1;
        }
      } else if (gal !== null && prev === gal) {
        lost.set(v, (lost.get(v) ?? 0) + 1);
      }
      const cx = Math.floor(x / scale);
      const cy = Math.floor(y / scale);
      if (cx < cols && cy < rows) touched.add(cy * cols + cx);
    }
    if ((i + 1) % bucket === 0 || i === log.length - 1) closeFrame(i + 1);
  }

  let galSummary: GalReplay | null = null;
  if (gal !== null && firstEvent > 0) {
    const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const position = rankedClans(pixels).indexOf(gal);
    galSummary = {
      pixels: pixels[gal]!,
      rank: position >= 0 ? position + 1 : null,
      firstEvent,
      peak,
      taken: sum(taken),
      lost: sum(lost),
      neutralTaken: taken.get(0) ?? 0,
      fronts: [...new Set([...taken.keys(), ...lost.keys()])]
        .filter((clan) => clan !== 0)
        .map((clan) => ({ clan, taken: taken.get(clan) ?? 0, lost: lost.get(clan) ?? 0 }))
        .sort((a, b) => b.taken + b.lost - (a.taken + a.lost) || a.clan - b.clan)
        .slice(0, FRONTS_KEPT),
    };
  }

  return { clanIds, gal, frames, deltas, bucket, cols, rows, check: { events: log.length, mismatches }, pixels, galSummary, grid };
}
