/**
 * Règles de la carte officielle, relevées dans le code de sa page le 5 novembre 2026
 * (`clanmap.openfront.io`). Le jeu peut les changer : les résultats restent des
 * repères indicatifs, et ne tiennent pas compte de la forme du territoire ni des
 * pixels verrouillés. Ces calculs ne modifient aucune donnée collectée.
 */
export const TROOPS_PER_CAP = 100;
export const NEUTRAL_PIXEL_TROOPS = 1_000;
export const ENEMY_PIXEL_BASE_TROOPS = 2_000;
export const RULES_CHECKED_ON = "2026-11-05";

export interface Standing {
  tag: string | null;
  color: number | null;
  pixels: number;
  troops: number | null;
}

/** Prix d'un pixel pris à un clan : un socle, plus ses troupes rapportées à son territoire. */
export function enemyPixelCost(troops: number | null, pixels: number): number {
  const defence = troops !== null && troops > 0 && pixels > 0 ? Math.ceil(troops / pixels) : 0;
  return ENEMY_PIXEL_BASE_TROOPS + defence;
}

export const capsToTroops = (caps: number) => Math.max(0, caps) * TROOPS_PER_CAP;
export const neutralPixelsFor = (troops: number) => Math.floor(Math.max(0, troops) / NEUTRAL_PIXEL_TROOPS);
export const capsForNeutralPixels = (pixels: number) => Math.ceil((Math.max(0, pixels) * NEUTRAL_PIXEL_TROOPS) / TROOPS_PER_CAP);

export interface Objective {
  rank: number;
  me: Standing;
  above: Standing | null;
  below: Standing | null;
  /** Pixels à gagner pour dépasser le clan juste devant. */
  gap: number | null;
  /** Avance sur le clan juste derrière. */
  lead: number | null;
}

/** La situation du clan dans l'ordre de la carte officielle. `null` s'il n'y a aucun pixel. */
export function objectiveFor(standings: readonly Standing[], tag: string): Objective | null {
  const at = standings.findIndex((s) => s.tag === tag);
  const me = standings[at];
  if (!me) return null;
  const above = standings[at - 1] ?? null;
  const below = standings[at + 1] ?? null;
  return {
    rank: at + 1,
    me,
    above,
    below,
    gap: above ? above.pixels - me.pixels + 1 : null,
    lead: below ? me.pixels - below.pixels : null,
  };
}

export interface Projection {
  rank: number;
  /** Clans dépassés grâce aux pixels ajoutés, du plus proche au plus lointain. */
  passed: string[];
  /** Le clan juste devant après ces pixels, et ce qu'il manquerait pour le dépasser. */
  next: Standing | null;
  missing: number | null;
}

/** Ce que deviendrait le rang avec des pixels en plus, les autres clans ne bougeant pas. */
export function projectRank(standings: readonly Standing[], tag: string, extraPixels: number): Projection | null {
  const objective = objectiveFor(standings, tag);
  if (!objective) return null;
  const total = objective.me.pixels + Math.max(0, extraPixels);
  const others = standings.filter((s) => s.tag !== tag);
  const ahead = others.filter((s) => s.pixels >= total);
  const next = ahead[ahead.length - 1] ?? null;
  const passed = standings
    .slice(0, objective.rank - 1)
    .filter((s) => s.pixels < total)
    .map((s) => s.tag ?? "Clan supprimé")
    .reverse();
  return { rank: ahead.length + 1, passed, next, missing: next ? next.pixels - total + 1 : null };
}

/**
 * Cases que le clan peindrait en s'étendant depuis sa frontière : d'abord les plus
 * proches, sur des terres neutres. Sert seulement à illustrer une simulation.
 */
export function expansionOrder(
  owners: Uint16Array,
  neutralLand: (cell: number) => boolean,
  clan: number,
  cols: number,
  rows: number,
  limit: number,
): Uint32Array {
  const size = cols * rows;
  const seen = new Uint8Array(size);
  let frontier: number[] = [];
  for (let cell = 0; cell < size; cell++) if (owners[cell] === clan) frontier.push(cell);
  const order = new Uint32Array(limit);
  let count = 0;
  while (frontier.length > 0 && count < limit) {
    const next: number[] = [];
    for (const cell of frontier) {
      const x = cell % cols;
      const neighbours = [x > 0 ? cell - 1 : -1, x < cols - 1 ? cell + 1 : -1, cell - cols, cell + cols];
      for (const n of neighbours) {
        if (n < 0 || n >= size || seen[n] || owners[n] !== 0 || !neutralLand(n)) continue;
        seen[n] = 1;
        if (count < limit) order[count++] = n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return order.subarray(0, count);
}
