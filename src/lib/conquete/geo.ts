/**
 * La géométrie de la carte de la Conquête : une projection à aires égales, puis une grille d'hexagones
 * identiques, qui décide des terres et de leurs voisins. À l'écran, ces cases sont déformées : les frontières
 * paraissent naturelles, et chaque terre garde exactement les mêmes voisins.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

export type Point = readonly [number, number];

/** Projection Equal Earth (Šavrič, Patterson, Jenny, 2018), pour une sphère de rayon 1. Angles en degrés. */
export function equalEarth(lonDeg: number, latDeg: number): Point {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const l = Math.asin(M * Math.sin(lat));
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  const x = (lon * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2)));
  const y = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2));
  return [x, y];
}

/** L'inverse d'equalEarth : retrouve [longitude, latitude] en degrés. */
export function equalEarthInverse(x: number, y: number): Point {
  let l = y / A1;
  for (let i = 0; i < 8; i++) {
    const l2 = l * l;
    const l6 = l2 * l2 * l2;
    const step = (l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)) - y) / (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2));
    l -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  const l2 = l * l;
  const l6 = l2 * l2 * l2;
  const lon = (x * M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))) / Math.cos(l);
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(l) / M)));
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Le monde entier, en unités de la carte (Equal Earth × 100, nord en haut) : ce que couvre l'image du relief. */
export const WORLD_VIEW = { minX: -273, minY: -132, maxX: 273, maxY: 132 } as const;

/** Rayon moyen de la Terre : une surface projetée × ce facteur donne des km². */
export const KM2_PER_UNIT = 6371.0088 ** 2;

export const hexArea = (size: number): number => (3 * Math.sqrt(3) * size * size) / 2;

/** Centre d'un hexagone à pointe en haut, en coordonnées axiales. */
export const hexCenter = (q: number, r: number, size: number): Point => [Math.sqrt(3) * size * (q + r / 2), 1.5 * size * r];

/** L'hexagone qui contient un point. */
export function hexAt(x: number, y: number, size: number): { q: number; r: number } {
  const fq = ((Math.sqrt(3) / 3) * x - y / 3) / size;
  const fr = ((2 / 3) * y) / size;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // `+ 0` : jamais de « moins zéro », qui ferait deux clés pour un même hexagone.
  return { q: q + 0, r: r + 0 };
}

/** Les six voisins directs. */
export const HEX_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Les six sommets, pour dessiner un hexagone centré sur (x, y). */
export function hexCorners(x: number, y: number, size: number): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return [x + size * Math.cos(angle), y + size * Math.sin(angle)] as const;
  });
}

/* ---------- Des frontières naturelles, sur la grille des règles ---------- */

/** Un bruit doux et reproductible, entre -1 et 1 : même point, même valeur, partout et à chaque génération. */
export function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const value = (a: number, b: number) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 1442968193);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = value(ix, iy) * (1 - sx) + value(ix + 1, iy) * sx;
  const bottom = value(ix, iy + 1) * (1 - sx) + value(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** Le bruit de calcul d'abord, l'arrondi ensuite : deux voisins écrivent exactement le même sommet. */
export const snapToMap = (n: number): number => Math.round(Math.round(n * 1e6) / 1e4) / 100;

/** Trois échelles de déformation, en unités de la carte : [longueur d'onde, amplitude]. */
const WARP_OCTAVES: readonly (readonly [number, number])[] = [
  [18, 2],
  [8, 1.6],
  [3.2, 0.32],
];

/** Déplace un point de la carte. La déformation est continue et ne dépend que de la position : les voisins restent voisins. */
export function warpPoint(x: number, y: number): Point {
  let dx = 0;
  let dy = 0;
  WARP_OCTAVES.forEach(([wave, amplitude], i) => {
    dx += smoothNoise(x / wave, y / wave, 11 + i) * amplitude;
    dy += smoothNoise(x / wave, y / wave, 31 + i) * amplitude;
  });
  return [x + dx, y + dy];
}

/** Segments par côté d'une terre : assez pour une frontière naturelle, sans alourdir le fichier de la carte. */
export const LAND_SIDE_SEGMENTS = 6;
/** De petits accidents sur la frontière, visibles de près. Bien plus petits qu'un segment : elle ne peut pas se replier. */
const BORDER_JITTER = 0.3;
const BORDER_JITTER_WAVE = 1.3;

/**
 * Le contour d'une terre : l'hexagone des règles, déformé. Le côté `i` va du sommet `i` au sommet `i + 1`,
 * sur `LAND_SIDE_SEGMENTS` segments. Deux voisins obtiennent exactement la même frontière.
 */
export function landCell(x: number, y: number, size: number): Point[] {
  const corners = hexCorners(x, y, size);
  const ring: Point[] = [];
  corners.forEach(([ax, ay], i) => {
    const [bx, by] = corners[(i + 1) % 6]!;
    for (let j = 0; j < LAND_SIDE_SEGMENTS; j++) {
      const t = j / LAND_SIDE_SEGMENTS;
      const px = snapToMap(ax + (bx - ax) * t);
      const py = snapToMap(ay + (by - ay) * t);
      const [wx, wy] = warpPoint(px, py);
      const jitterX = smoothNoise(px / BORDER_JITTER_WAVE, py / BORDER_JITTER_WAVE, 51) * BORDER_JITTER;
      const jitterY = smoothNoise(px / BORDER_JITTER_WAVE, py / BORDER_JITTER_WAVE, 52) * BORDER_JITTER;
      ring.push([snapToMap(wx + jitterX), snapToMap(wy + jitterY)]);
    }
  });
  return ring;
}

export const landCellPath = (x: number, y: number, size: number): string => `M${landCell(x, y, size).map(([px, py]) => `${px} ${py}`).join("L")}Z`;

/** Un point dans un polygone : le premier anneau est l'extérieur, les suivants sont des trous. */
export function pointInRings(x: number, y: number, rings: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
