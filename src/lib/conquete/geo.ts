/**
 * La géométrie de la carte de la Conquête : une projection à aires égales, puis une grille
 * d'hexagones identiques. Deux hexagones couvrent donc la même surface réelle, où qu'ils soient.
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

export const hexPath = (x: number, y: number, size: number): string =>
  `M${hexCorners(x, y, size)
    .map(([px, py]) => `${Math.round(px * 100) / 100} ${Math.round(py * 100) / 100}`)
    .join("L")}Z`;

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
