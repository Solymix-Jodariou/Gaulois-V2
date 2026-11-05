/**
 * Logique de l'effet décoratif « territoire » : une grille de cases qui se
 * colorent et s'éteignent. Fonctions pures, sans DOM, pour pouvoir les tester.
 * Aucune de ces valeurs n'est une donnée du clan.
 */
export const TILE_SIZE = 28;

/** Durée de vie caractéristique d'une case allumée, en secondes. */
export const TILE_TAU = 1.1;

export interface Grid {
  cols: number;
  rows: number;
  size: number;
}

export function makeGrid(width: number, height: number, size = TILE_SIZE): Grid {
  return {
    cols: Math.max(1, Math.ceil(width / size)),
    rows: Math.max(1, Math.ceil(height / size)),
    size,
  };
}

/** Bruit déterministe entre 0 et 1, propre à une case et à une vague. */
export function tileNoise(col: number, row: number, seed: number): number {
  let h = Math.imul(col, 73856093) ^ Math.imul(row, 19349663) ^ Math.imul(seed, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Arrival {
  /** Indice de la case dans la grille. */
  index: number;
  /** Instant où la vague atteint la case, en secondes après son départ. */
  at: number;
}

/** Rayon maximal d'une vague par rapport au rayon demandé, à cause de sa forme irrégulière. */
export const WAVE_MAX_REACH = 1.25;

/**
 * Prépare une vague partant de (x, y) : les cases touchées, de la plus proche à
 * la plus lointaine. Le contour et le front sont irréguliers, comme une frontière.
 */
export function planWave(grid: Grid, x: number, y: number, radius: number, speed: number, seed = 0): Arrival[] {
  const { cols, rows, size } = grid;
  const span = radius * WAVE_MAX_REACH;
  const minCol = Math.max(0, Math.floor((x - span) / size));
  const maxCol = Math.min(cols - 1, Math.floor((x + span) / size));
  const minRow = Math.max(0, Math.floor((y - span) / size));
  const maxRow = Math.min(rows - 1, Math.floor((y + span) / size));
  const arrivals: Arrival[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const dx = (col + 0.5) * size - x;
      const dy = (row + 0.5) * size - y;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const lobes = 1 + 0.16 * Math.sin(3 * angle + seed) + 0.09 * Math.sin(7 * angle + seed * 2.3);
      const noise = tileNoise(col, row, seed);
      if (distance > radius * lobes * (0.82 + 0.18 * noise)) continue;
      arrivals.push({ index: row * cols + col, at: (distance / speed) * (0.85 + 0.4 * noise) });
    }
  }
  return arrivals.sort((a, b) => a.at - b.at);
}

/** Plus petit rayon possible d'une vague par rapport au rayon demandé. */
export const WAVE_MIN_REACH = 0.615;

/**
 * Vague qui couvre toutes les cases d'une grille en `duration` secondes au plus,
 * pour révéler un bloc case par case à partir d'un point.
 */
export function coverWave(grid: Grid, x: number, y: number, duration: number, seed = 0): Arrival[] {
  const width = grid.cols * grid.size;
  const height = grid.rows * grid.size;
  const far =
    Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y)) +
    grid.size;
  return planWave(grid, x, y, far / WAVE_MIN_REACH, (far * 1.25) / duration, seed);
}

/** Tracé SVG d'une case, pour construire un `clip-path: path(...)`. */
export function tilePath(index: number, grid: Grid): string {
  const x = (index % grid.cols) * grid.size;
  const y = Math.floor(index / grid.cols) * grid.size;
  return `M${x} ${y}h${grid.size}v${grid.size}h-${grid.size}z`;
}

export interface BrushTile {
  index: number;
  /** 1 au centre du pinceau, proche de 0 sur son bord. */
  strength: number;
}

/** Cases sous le curseur, plus fortes au centre. */
export function brush(grid: Grid, x: number, y: number, radius: number): BrushTile[] {
  const { cols, rows, size } = grid;
  const minCol = Math.max(0, Math.floor((x - radius) / size));
  const maxCol = Math.min(cols - 1, Math.floor((x + radius) / size));
  const minRow = Math.max(0, Math.floor((y - radius) / size));
  const maxRow = Math.min(rows - 1, Math.floor((y + radius) / size));
  const tiles: BrushTile[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const distance = Math.hypot((col + 0.5) * size - x, (row + 0.5) * size - y);
      if (distance < radius) tiles.push({ index: row * cols + col, strength: 1 - distance / radius });
    }
  }
  return tiles;
}

/** Points réguliers entre deux positions du curseur, pour une traînée sans trou. */
export function segment(x0: number, y0: number, x1: number, y1: number, step: number, maxPoints = 64): [number, number][] {
  const count = Math.min(maxPoints, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)));
  const points: [number, number][] = [];
  for (let i = 1; i <= count; i++) {
    points.push([x0 + ((x1 - x0) * i) / count, y0 + ((y1 - y0) * i) / count]);
  }
  return points;
}

/** Intensité restante d'une case après `dt` secondes. */
export function decay(level: number, dt: number, tau = TILE_TAU): number {
  return level * Math.exp(-dt / tau);
}
