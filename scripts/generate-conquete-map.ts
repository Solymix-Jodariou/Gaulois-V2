/**
 * Génère la carte de la Conquête depuis Natural Earth (domaine public).
 * Se lance à la main : `npm run conquete:map`. Une carte existante ne change jamais de numéro :
 * pour en créer une autre, changer VERSION et le nombre d'hexagones.
 *
 * Écrit :
 *  - public/conquete/map-<version>.json : pour dessiner la carte ;
 *  - supabase/migrations/…_carte_<version>.sql : pour que le serveur connaisse noms, relief et voisins.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import polygonClipping, { type MultiPolygon, type Polygon as ClipPolygon, type Ring as ClipRing } from "polygon-clipping";
import { HEX_DIRECTIONS, KM2_PER_UNIT, LAND_SIDE_SEGMENTS, equalEarth, hexArea, hexAt, hexCenter, landCell, pointInRings, snapToMap, warpPoint, type Point } from "../src/lib/conquete/geo";
import { NAME_OVERRIDES } from "./conquete-map-names";

const VERSION = "v1";
/** Un hexagone couvre environ 270 000 km² : la moitié de la France. */
const TARGET_KM2 = 270_000;
const LAND_SHARE = 0.4;
/** Au-delà, la banquise : personne n'y gagne rien, et la carte reste plus lisible. */
const MAX_LATITUDE = 74;
/** Une grande île sans hexagone en reçoit un malgré tout. */
const ISLAND_MIN_KM2 = 30_000;
const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const CACHE = ".cache/natural-earth";
const FILES = ["ne_110m_land", "ne_50m_land", "ne_10m_populated_places", "ne_10m_geography_regions_polys", "ne_50m_lakes"] as const;
/** Finesse des côtes des territoires, en unités de la carte : invisible même au zoom maximal. */
const COAST_TOLERANCE = 0.08;
/** En dessous, un îlot ou un éclat de côte n'est pas colorié (unités² de la carte ; 1 unité² ≈ 4 000 km²). */
const MIN_RING_AREA = 0.1;
/** Routes de haute mer, pour que le monde ne soit pas une simple chaîne : [lon, lat] de chaque côté. */
const OCEAN_ROUTES: readonly { from: Point; to: Point; wrap?: boolean }[] = [
  { from: [-37, -7], to: [-16, 14] }, // Brésil et Afrique de l'Ouest
  { from: [-56, 49], to: [-9, 53] }, // Terre-Neuve et Irlande
  { from: [-165, 65], to: [175, 65], wrap: true }, // Détroit de Béring, de part et d'autre du bord de la carte
];

type Ring = Point[];
interface Polygon {
  rings: Ring[];
  box: [number, number, number, number];
  areaKm2: number;
}
interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

async function load(name: string): Promise<Feature[]> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${name}.geojson`);
  if (!existsSync(path)) {
    console.log(`Téléchargement de ${name}…`);
    const res = await fetch(`${SOURCE}/${name}.geojson`, { headers: { "User-Agent": "GAL-clan-site/1.0" } });
    if (!res.ok) throw new Error(`${name} : HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return (JSON.parse(readFileSync(path, "utf8")) as { features: Feature[] }).features;
}

const ringArea = (ring: Ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(sum) / 2;
};

function polygonsOf(features: Feature[], keep: (f: Feature) => boolean = () => true): (Polygon & { feature: Feature })[] {
  const out: (Polygon & { feature: Feature })[] = [];
  for (const feature of features) {
    if (!keep(feature)) continue;
    const { type, coordinates } = feature.geometry;
    const list = (type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : []) as number[][][][];
    for (const polygon of list) {
      // L'Antarctique ne compte pas : personne n'y joue.
      if (Math.max(...polygon[0]!.map((p) => p[1]!)) < -60) continue;
      const rings = polygon.map((ring) => ring.map(([lon, lat]) => equalEarth(lon!, lat!)));
      const xs = rings[0]!.map((p) => p[0]);
      const ys = rings[0]!.map((p) => p[1]);
      out.push({
        rings,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        areaKm2: (ringArea(rings[0]!) - rings.slice(1).reduce((n, r) => n + ringArea(r), 0)) * KM2_PER_UNIT,
        feature,
      });
    }
  }
  return out;
}

const inBox = (x: number, y: number, box: Polygon["box"]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
const inAny = (x: number, y: number, polygons: readonly Polygon[]) => polygons.some((p) => inBox(x, y, p.box) && pointInRings(x, y, p.rings));

/** Des points répartis dans un hexagone, pour mesurer ce qu'il contient. */
function samples(cx: number, cy: number, size: number): Point[] {
  const out: Point[] = [];
  const step = size / 4;
  for (let dx = -size; dx <= size; dx += step) {
    for (let dy = -size; dy <= size; dy += step) {
      const { q, r } = hexAt(dx, dy, size);
      if (q === 0 && r === 0) out.push([cx + dx, cy + dy]);
    }
  }
  return out;
}

const size = Math.sqrt((TARGET_KM2 / KM2_PER_UNIT) / ((3 * Math.sqrt(3)) / 2));
const [land110, land50, places, regions, lakes50] = await Promise.all(FILES.map(load));

const land = polygonsOf(land50!);
const lakes = polygonsOf(lakes50!);
const mountains = polygonsOf(regions!, (f) => f.properties["FEATURECLA"] === "Range/mtn");
const plateaus = polygonsOf(regions!, (f) => f.properties["FEATURECLA"] === "Plateau" || f.properties["FEATURECLA"] === "Foothills");

interface Cell {
  q: number;
  r: number;
  x: number;
  y: number;
  share: number;
  mountain: number;
  plateau: number;
}
const key = (q: number, r: number) => `${q},${r}`;
const cells = new Map<string, Cell>();
const measure = (q: number, r: number): Cell => {
  const [x, y] = hexCenter(q, r, size);
  const points = samples(x, y, size);
  const onLand = points.filter(([px, py]) => inAny(px, py, land));
  const share = onLand.length / points.length;
  const of = (polygons: readonly Polygon[]) => (onLand.length === 0 ? 0 : onLand.filter(([px, py]) => inAny(px, py, polygons)).length / onLand.length);
  return { q, r, x, y, share, mountain: of(mountains), plateau: of(plateaus) };
};

const reach = 3.2;
const topY = equalEarth(0, MAX_LATITUDE)[1];
const maxQ = Math.ceil(reach / (Math.sqrt(3) * size));
const maxR = Math.ceil(1.45 / (1.5 * size));
for (let r = -maxR; r <= maxR; r++) {
  for (let q = -maxQ - maxR; q <= maxQ + maxR; q++) {
    const [x, y] = hexCenter(q, r, size);
    if (Math.abs(x) > reach || y < -1.15 || y > topY) continue;
    const cell = measure(q, r);
    if (cell.share >= LAND_SHARE) cells.set(key(q, r), cell);
  }
}
console.log(`Hexagones sur la terre ferme : ${cells.size}`);

// Une grande île trop petite pour remplir un hexagone en reçoit un malgré tout.
for (const island of land.filter((p) => p.areaKm2 >= ISLAND_MIN_KM2 && p.box[1] < topY).sort((a, b) => b.areaKm2 - a.areaKm2)) {
  const [minX, minY, maxX, maxY] = island.box;
  let best: { q: number; r: number; hits: number } | null = null;
  const counts = new Map<string, number>();
  const step = size / 6;
  let covered = false;
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) {
      if (!pointInRings(x, y, island.rings)) continue;
      const { q, r } = hexAt(x, y, size);
      if (cells.has(key(q, r))) covered = true;
      const hits = (counts.get(key(q, r)) ?? 0) + 1;
      counts.set(key(q, r), hits);
      if (!best || hits > best.hits) best = { q, r, hits };
    }
  }
  if (!covered && best) {
    cells.set(key(best.q, best.r), measure(best.q, best.r));
    console.log(`Île ajoutée : ${Math.round(island.areaKm2)} km² autour de ${key(best.q, best.r)}`);
  }
}

const ordered = [...cells.values()].sort((a, b) => a.r - b.r || a.q - b.q);
const idOf = new Map(ordered.map((c, i) => [key(c.q, c.r), i + 1]));

/* ---------- Les voisins ---------- */

const neighbours = new Map<number, Set<number>>(ordered.map((_, i) => [i + 1, new Set<number>()]));
const link = (a: number, b: number) => {
  if (a === b) return;
  neighbours.get(a)!.add(b);
  neighbours.get(b)!.add(a);
};
const routes: { a: number; b: number; wrap?: boolean }[] = [];
for (const cell of ordered) {
  const id = idOf.get(key(cell.q, cell.r))!;
  for (const [dq, dr] of HEX_DIRECTIONS) {
    const other = idOf.get(key(cell.q + dq, cell.r + dr));
    if (other) link(id, other);
  }
  // Par-dessus un hexagone de mer : tout droit, ou en biais si les deux cases du milieu sont de la mer.
  for (let i = 0; i < 6; i++) {
    const [dq, dr] = HEX_DIRECTIONS[i]!;
    const [eq, er] = HEX_DIRECTIONS[(i + 1) % 6]!;
    const straight = idOf.get(key(cell.q + 2 * dq, cell.r + 2 * dr));
    if (straight && !idOf.has(key(cell.q + dq, cell.r + dr))) link(id, straight);
    const slanted = idOf.get(key(cell.q + dq + eq, cell.r + dr + er));
    if (slanted && !idOf.has(key(cell.q + dq, cell.r + dr)) && !idOf.has(key(cell.q + eq, cell.r + er))) link(id, slanted);
  }
}

const nearest = ([lon, lat]: Point) => {
  const [x, y] = equalEarth(lon, lat);
  let best = ordered[0]!;
  let bestDistance = Infinity;
  for (const cell of ordered) {
    const distance = (cell.x - x) ** 2 + (cell.y - y) ** 2;
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return idOf.get(key(best.q, best.r))!;
};
for (const route of OCEAN_ROUTES) {
  const a = nearest(route.from);
  const b = nearest(route.to);
  link(a, b);
  routes.push({ a, b, ...(route.wrap ? { wrap: true } : {}) });
}

// Tout le monde doit pouvoir atteindre tout le monde : on relie chaque groupe isolé au plus proche.
const components = (): number[][] => {
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue;
    const group: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      group.push(id);
      for (const n of neighbours.get(id)!) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length);
};
for (let groups = components(); groups.length > 1; groups = components()) {
  const [main, isolated] = groups as [number[], number[]];
  let best: [number, number] = [main[0]!, isolated[0]!];
  let bestDistance = Infinity;
  for (const a of isolated) {
    const ca = ordered[a - 1]!;
    for (const b of main) {
      const cb = ordered[b - 1]!;
      const distance = (ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [b, a];
      }
    }
  }
  link(best[0], best[1]);
  routes.push({ a: best[0], b: best[1] });
}

/* ---------- Le relief ---------- */

const terrainOf = (cell: Cell): "plains" | "highland" | "mountain" => {
  if (cell.mountain >= 0.45) return "mountain";
  if (cell.mountain >= 0.18 || cell.plateau >= 0.55) return "highland";
  return "plains";
};

/* ---------- Les noms ---------- */

interface Place {
  x: number;
  y: number;
  name: string;
  population: number;
  country: string;
}
const placeList: Place[] = places!
  .map((f) => {
    const p = f.properties;
    const [lon, lat] = (f.geometry.coordinates as number[]) as [number, number];
    const [x, y] = equalEarth(lon, lat);
    return {
      x,
      y,
      name: String(p["NAME_FR"] || p["NAME"] || "").trim(),
      population: Number(p["POP_MAX"] ?? 0),
      country: String(p["ADM0NAME"] ?? ""),
    };
  })
  .filter((p) => p.name !== "");

const placesByCell = new Map<string, Place[]>();
for (const place of placeList) {
  const { q, r } = hexAt(place.x, place.y, size);
  const k = key(q, r);
  if (!cells.has(k)) continue;
  (placesByCell.get(k) ?? placesByCell.set(k, []).get(k)!).push(place);
}

const regionPolys = polygonsOf(regions!, (f) => String(f.properties["NAME_FR"] || f.properties["NAME"] || "") !== "");
const taken = new Set<string>();
const claim = (name: string) => {
  if (taken.has(name)) return false;
  taken.add(name);
  return true;
};
const named = ordered.map((cell) => {
  const candidates = (placesByCell.get(key(cell.q, cell.r)) ?? []).sort((a, b) => b.population - a.population);
  const best = candidates[0];
  const override = best ? NAME_OVERRIDES[best.name] : undefined;
  if (override && claim(override)) return { cell, name: override, country: best?.country ?? "" };
  for (const place of candidates) {
    if (NAME_OVERRIDES[place.name]) continue;
    if (claim(place.name)) return { cell, name: place.name, country: place.country };
  }
  // Pas de ville : la région naturelle, sinon la ville la plus proche.
  const region = regionPolys.find((p) => inBox(cell.x, cell.y, p.box) && pointInRings(cell.x, cell.y, p.rings));
  const rawRegion = region ? String(region.feature.properties["NAME_FR"] || region.feature.properties["NAME"]) : "";
  const regionName = NAME_OVERRIDES[rawRegion] ?? rawRegion;
  if (regionName && claim(regionName)) return { cell, name: regionName, country: "" };
  const close = [...placeList].sort((a, b) => (a.x - cell.x) ** 2 + (a.y - cell.y) ** 2 - ((b.x - cell.x) ** 2 + (b.y - cell.y) ** 2));
  for (const place of close) {
    const name = NAME_OVERRIDES[place.name] ?? place.name;
    if (claim(name)) return { cell, name, country: place.country };
  }
  throw new Error(`Aucun nom pour ${key(cell.q, cell.r)}`);
});

/* ---------- Les contours : chaque terre a des frontières naturelles et s'arrête à la côte ---------- */

const snap = snapToMap;
const toMapUnits = (ring: readonly Point[]): ClipRing => ring.map(([x, y]) => [x * 100, -y * 100]);
const clipGeometry = (p: Polygon): ClipPolygon => p.rings.map(toMapUnits);
const signedArea = (ring: readonly Point[]) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return sum / 2;
};

/** Douglas-Peucker sur une portion de côte : ses deux extrémités restent en place. */
function simplifyChain(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const [ax, ay] = points[0]!;
  const [bx, by] = points.at(-1)!;
  const length = Math.hypot(bx - ax, by - ay);
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!;
    const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= COAST_TOLERANCE) return [points[0]!, points.at(-1)!];
  return [...simplifyChain(points.slice(0, index + 1)).slice(0, -1), ...simplifyChain(points.slice(index))];
}

/** Simplifie les côtes d'un anneau fermé, sans toucher aux points posés sur le bord de l'hexagone. */
function simplifyRing(ring: readonly Point[], onBorder: (p: Point) => boolean): Point[] {
  const open = ring.slice(0, -1);
  const anchors = open.flatMap((p, i) => (onBorder(p) ? [i] : []));
  if (anchors.length < 2) {
    // Une île entière : on la coupe en deux au point le plus éloigné du premier.
    let far = 0;
    let best = -1;
    open.forEach(([x, y], i) => {
      const distance = Math.hypot(x - open[0]![0], y - open[0]![1]);
      if (distance > best) {
        best = distance;
        far = i;
      }
    });
    if (far === 0) return open;
    return [...simplifyChain(open.slice(0, far + 1)).slice(0, -1), ...simplifyChain([...open.slice(far), open[0]!]).slice(0, -1)];
  }
  const out: Point[] = [];
  for (let a = 0; a < anchors.length; a++) {
    const from = anchors[a]!;
    const to = anchors[(a + 1) % anchors.length]!;
    const chain = to > from ? open.slice(from, to + 1) : [...open.slice(from), ...open.slice(0, to + 1)];
    out.push(...simplifyChain(chain).slice(0, -1));
  }
  return out;
}

const overlaps = (a: Polygon["box"], minX: number, minY: number, maxX: number, maxY: number) => a[0] <= maxX && a[2] >= minX && a[1] <= maxY && a[3] >= minY;

// La déformation ne doit jamais retourner la carte : sinon, deux terres pourraient se chevaucher.
{
  const STEP = 0.5;
  const H = 0.05;
  let worst = Infinity;
  for (let y = -140; y <= 110; y += STEP) {
    for (let x = -280; x <= 280; x += STEP) {
      const [ax, ay] = warpPoint(x - H, y);
      const [bx, by] = warpPoint(x + H, y);
      const [cx, cy] = warpPoint(x, y - H);
      const [dx, dy] = warpPoint(x, y + H);
      worst = Math.min(worst, ((bx - ax) * (dy - cy) - (by - ay) * (dx - cx)) / (4 * H * H));
    }
  }
  console.log(`Déformation : surface locale multipliée par ${worst.toFixed(2)} au minimum.`);
  if (worst < 0.05) throw new Error("La déformation retourne la carte : réduire ses amplitudes.");
}

/** La distance d'un point à un segment. */
const toSegment = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

/** Deux segments qui se croisent : la déformation aurait replié une frontière sur elle-même. */
const crosses = (a: Point, b: Point, c: Point, d: Point) => {
  const side = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

/**
 * Le dessin d'un territoire : sa case déformée, moins la mer et les grands lacs.
 * `edges` dit ce que longe chaque segment, anneau par anneau : le numéro du côté, ou `c` pour la côte.
 */
function shapeOf(cell: Cell): { shape: string; edges: string } {
  const outline = landCell(cell.x * 100, -cell.y * 100, size * 100);
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    for (let j = i + 2; j < outline.length; j++) {
      if (i === 0 && j === outline.length - 1) continue;
      if (crosses(a, b, outline[j]!, outline[(j + 1) % outline.length]!)) throw new Error(`Frontière repliée sur elle-même autour de ${key(cell.q, cell.r)} : réduire la déformation.`);
    }
  });
  const xs = outline.map((c) => c[0] / 100);
  const ys = outline.map((c) => -c[1] / 100);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  const closed: ClipRing = [...outline, outline[0]!].map(([x, y]) => [x, y]);
  const area: ClipPolygon = [closed];
  let result: MultiPolygon = land
    .filter((p) => overlaps(p.box, ...box))
    .flatMap((p) => polygonClipping.intersection(area, clipGeometry(p)));
  const nearLakes = lakes.filter((p) => overlaps(p.box, ...box)).map(clipGeometry);
  if (nearLakes.length > 0 && result.length > 0) result = polygonClipping.difference(result, ...nearLakes);

  const segmentAt = (i: number) => [outline[i]!, outline[(i + 1) % outline.length]!] as const;
  const onBorder = (p: Point) => outline.some((_, i) => toSegment(p, ...segmentAt(i)) < 1e-6);
  /** Le côté de la case que longe un point, ou -1. L'arrondi au centième explique la tolérance. */
  const sideOf = (p: Point, side: number) => Array.from({ length: LAND_SIDE_SEGMENTS }, (_, j) => toSegment(p, ...segmentAt(side * LAND_SIDE_SEGMENTS + j))).some((d) => d < 0.016);
  const edgeCode = (a: Point, b: Point) => {
    const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (let side = 0; side < 6; side++) {
      if (sideOf(a, side) && sideOf(b, side) && sideOf(middle, side)) return String(side);
    }
    return "c";
  };

  const rings = result.flatMap((polygon) =>
    polygon.flatMap((ring) => {
      const points = ring as Point[];
      if (Math.abs(signedArea(points.slice(0, -1))) < MIN_RING_AREA) return [];
      const rounded = simplifyRing(points, onBorder).map(([x, y]) => [snap(x), snap(y)] as const);
      const unique = rounded.filter(([x, y], i) => {
        const [px, py] = rounded[(i + rounded.length - 1) % rounded.length]!;
        return x !== px || y !== py;
      });
      return unique.length < 3 ? [] : [unique];
    }),
  );
  // Une case presque entièrement dans un lac ou un archipel : on garde la case entière.
  const kept = rings.length > 0 ? rings : [outline];
  return {
    shape: kept.map((ring) => `M${ring.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join(""),
    edges: kept.map((ring) => ring.map((a, i) => edgeCode(a, ring[(i + 1) % ring.length]!)).join("")).join("|"),
  };
}

/* ---------- Les fichiers ---------- */

const round = (n: number) => Math.round(n * 1000) / 10;
const silhouette = polygonsOf(land110!)
  .map((p) => `M${p.rings[0]!.map(([x, y]) => `${round(x)} ${round(-y)}`).join("L")}Z`)
  .join("");

const territories = named.map(({ cell, name }, i) => ({
  id: i + 1,
  x: snap(cell.x * 100),
  y: snap(-cell.y * 100),
  name,
  terrain: terrainOf(cell),
  neighbours: [...neighbours.get(i + 1)!].sort((a, b) => a - b),
  ...shapeOf(cell),
}));
const xs = territories.map((t) => t.x);
const ys = territories.map((t) => t.y);
const size100 = Math.round(size * 1_000_000) / 10_000;
const margin = (v: number) => Math.round(v * 100) / 100;
const map = {
  version: VERSION,
  source: "Natural Earth (domaine public), projection Equal Earth",
  hexKm2: Math.round(hexArea(size) * KM2_PER_UNIT),
  hexSize: size100,
  bounds: { minX: margin(Math.min(...xs) - size100), minY: margin(Math.min(...ys) - size100), maxX: margin(Math.max(...xs) + size100), maxY: margin(Math.max(...ys) + size100) },
  land: silhouette,
  routes,
  territories,
};

mkdirSync("public/conquete", { recursive: true });
writeFileSync(`public/conquete/map-${VERSION}.json`, `${JSON.stringify(map)}\n`);

const escape = (s: string) => s.replaceAll("'", "''");
const rows = territories.map((t) => `('${VERSION}', ${t.id}, '${escape(t.name)}', '${t.terrain}', '{${t.neighbours.join(",")}}')`);
writeFileSync(
  `supabase/migrations/20261105000700_carte_${VERSION}.sql`,
  `-- Fichier généré par scripts/generate-conquete-map.ts : ne pas modifier à la main.\n-- Source : Natural Earth (domaine public).\ninsert into public.territories (map_version, id, name, terrain, neighbours) values\n${rows.join(",\n")};\n`,
);

const count = (terrain: string) => territories.filter((t) => t.terrain === terrain).length;
const degree = territories.map((t) => t.neighbours.length);
console.log(`Carte ${VERSION} : ${territories.length} territoires de ${map.hexKm2} km² chacun.`);
console.log(`Relief : ${count("plains")} plaines, ${count("highland")} collines, ${count("mountain")} montagnes.`);
console.log(`Voisins : de ${Math.min(...degree)} à ${Math.max(...degree)}. Routes de haute mer : ${routes.length}.`);
console.log(`Fichier carte : ${Math.round(JSON.stringify(map).length / 1024)} Ko.`);
writeFileSync(join(CACHE, `noms-${VERSION}.txt`), named.map(({ name, country }, i) => `${i + 1}\t${name}\t${country}`).join("\n"));
for (const route of routes) console.log(`Route : ${territories[route.a - 1]!.name} et ${territories[route.b - 1]!.name}`);
