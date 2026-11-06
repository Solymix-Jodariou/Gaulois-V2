/**
 * Du découpage des règles au dessin de la carte : les terres d'un même joueur se fondent en
 * une seule masse, bordée seulement là où elle s'arrête, et portent son nom et ses troupes.
 * Rien ici ne décide de quoi que ce soit : c'est le dessin de ce que le serveur a dit.
 */
import { hexAt, warpPoint, type Point } from "./geo";
import type { GameMap, MapTerritory } from "./types";

/** Le voisin que regarde chaque côté, dans l'ordre de `hexCorners` (y vers le bas). */
const SIDE_NEIGHBOURS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
] as const;

export interface Outline {
  id: number;
  shape: string;
  /** La bordure qui existe toujours : la mer ne se conquiert pas. */
  coast: string;
  /** Pour chacun des six côtés : le tracé, et le territoire qui se trouve de l'autre côté. */
  sides: readonly { path: string; across: number | null }[];
}

export function parseRings(shape: string): Point[][] {
  return shape
    .split("Z")
    .filter(Boolean)
    .map((ring) =>
      ring
        .slice(1)
        .split("L")
        .map((pair) => {
          const space = pair.indexOf(" ");
          return [Number(pair.slice(0, space)), Number(pair.slice(space + 1))] as const;
        }),
    );
}

const cache = new WeakMap<object, Outline[]>();

/** Le tracé de chaque territoire, trié par côté une fois pour toutes : la carte ne change jamais. */
export function outlinesOf(map: Pick<GameMap, "hexSize" | "territories">): Outline[] {
  const known = cache.get(map);
  if (known) return known;
  const cells = map.territories.map((t) => hexAt(t.x, t.y, map.hexSize));
  const at = new Map(cells.map((c, i) => [`${c.q},${c.r}`, map.territories[i]!.id]));

  const outlines = map.territories.map((t, i): Outline => {
    const { q, r } = cells[i]!;
    const paths = ["", "", "", "", "", ""];
    let coast = "";
    // Le générateur a noté ce que longe chaque segment : le numéro du côté, ou « c » pour la côte.
    const codes = t.edges.split("|");
    parseRings(t.shape).forEach((ring, ringIndex) => {
      ring.forEach((a, index) => {
        const b = ring[(index + 1) % ring.length]!;
        const segment = `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
        const code = codes[ringIndex]![index]!;
        if (code === "c") coast += segment;
        else paths[Number(code)] += segment;
      });
    });
    return {
      id: t.id,
      shape: t.shape,
      coast,
      sides: SIDE_NEIGHBOURS.map(([dq, dr], side) => ({ path: paths[side]!, across: at.get(`${q + dq},${r + dr}`) ?? null })),
    };
  });
  cache.set(map, outlines);
  return outlines;
}

type Owned = { owner: number; garrison?: number };

export interface OwnerLayer {
  owner: number;
  fill: string;
  border: string;
}

/** Un seul tracé par joueur : aucune couture entre deux de ses territoires. */
export function ownerLayers(outlines: readonly Outline[], states: ReadonlyMap<number, Owned>): OwnerLayer[] {
  const layers = new Map<number, OwnerLayer>();
  for (const outline of outlines) {
    const state = states.get(outline.id);
    if (!state) continue;
    let layer = layers.get(state.owner);
    if (!layer) {
      layer = { owner: state.owner, fill: "", border: "" };
      layers.set(state.owner, layer);
    }
    layer.fill += outline.shape;
    layer.border += outline.coast;
    for (const { path, across } of outline.sides) {
      if (path && (across === null || states.get(across)?.owner !== state.owner)) layer.border += path;
    }
  }
  return [...layers.values()];
}

export interface OwnerLabel {
  owner: number;
  x: number;
  y: number;
  /** Le territoire sous l'étiquette : celui qu'on ouvre pour trouver ce joueur sur la carte. */
  anchor: number;
  /** La place disponible, en unités de la carte. */
  width: number;
  height: number;
  territories: number;
  garrison: number;
}

/** Une étiquette par joueur, sur son plus grand ensemble de terres d'un seul tenant. */
export function ownerLabels(map: Pick<GameMap, "hexSize" | "territories">, states: ReadonlyMap<number, Owned>): OwnerLabel[] {
  const outlines = outlinesOf(map);
  const byId = new Map(outlines.map((o) => [o.id, o]));
  const territories = new Map<number, MapTerritory>(map.territories.map((t) => [t.id, t]));
  const totals = new Map<number, { territories: number; garrison: number }>();
  const biggest = new Map<number, number[]>();
  const seen = new Set<number>();

  for (const outline of outlines) {
    const state = states.get(outline.id);
    if (!state) continue;
    const total = totals.get(state.owner) ?? { territories: 0, garrison: 0 };
    total.territories += 1;
    total.garrison += state.garrison ?? 0;
    totals.set(state.owner, total);
    if (seen.has(outline.id)) continue;
    const group: number[] = [];
    const stack = [outline.id];
    seen.add(outline.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      group.push(id);
      for (const { across } of byId.get(id)!.sides) {
        if (across !== null && !seen.has(across) && states.get(across)?.owner === state.owner) {
          seen.add(across);
          stack.push(across);
        }
      }
    }
    if (group.length > (biggest.get(state.owner)?.length ?? 0)) biggest.set(state.owner, group);
  }

  const hexWidth = Math.sqrt(3) * map.hexSize;
  const hexHeight = 2 * map.hexSize;
  return [...biggest].map(([owner, group]) => {
    // Le milieu de chaque terre tel qu'il est dessiné : les frontières sont déformées, lui aussi.
    const cells = group.map((id) => {
      const [x, y] = warpPoint(territories.get(id)!.x, territories.get(id)!.y);
      return { id, x, y };
    });
    const xs = cells.map((t) => t.x);
    const ys = cells.map((t) => t.y);
    const cx = xs.reduce((a, b) => a + b, 0) / cells.length;
    const cy = ys.reduce((a, b) => a + b, 0) / cells.length;
    const nearest = cells.reduce((best, t) => ((t.x - cx) ** 2 + (t.y - cy) ** 2 < (best.x - cx) ** 2 + (best.y - cy) ** 2 ? t : best));
    // Un ensemble en croissant : son centre tombe hors de ses terres, on se pose sur la plus proche.
    const inside = Math.hypot(nearest.x - cx, nearest.y - cy) < map.hexSize * 0.75;
    // Un long ruban en diagonale n'offre pas toute sa largeur : on compte aussi avec sa surface.
    const roundWidth = Math.sqrt(cells.length) * hexWidth * 1.25;
    const total = totals.get(owner)!;
    return {
      owner,
      x: inside ? cx : nearest.x,
      y: inside ? cy : nearest.y,
      anchor: nearest.id,
      width: Math.min(Math.max(...xs) - Math.min(...xs) + hexWidth, roundWidth),
      height: Math.min(Math.max(...ys) - Math.min(...ys) + hexHeight, roundWidth),
      territories: total.territories,
      garrison: total.garrison,
    };
  });
}

export interface Capture {
  id: number;
  owner: number;
  /** D'où part la couleur : le milieu de la terre voisine du même joueur, ou la terre elle-même s'il n'en a pas. */
  fromX: number;
  fromY: number;
}

/** Au-delà, c'est un premier chargement ou un rattrapage : on ne fait pas clignoter toute la carte. */
const MAX_CAPTURES = 12;

/** Les terres qui viennent de changer de main, pour montrer la couleur qui s'y répand. Rien ici ne décide de quoi que ce soit. */
export function capturedLands(map: Pick<GameMap, "territories">, before: ReadonlyMap<number, Owned>, after: ReadonlyMap<number, Owned>): Capture[] {
  const byId = new Map<number, MapTerritory>(map.territories.map((t) => [t.id, t]));
  const out: Capture[] = [];
  for (const [id, state] of after) {
    if (before.get(id)?.owner === state.owner) continue;
    const land = byId.get(id);
    if (!land) continue;
    const from = land.neighbours.map((n) => byId.get(n)).find((n) => n && before.get(n.id)?.owner === state.owner) ?? land;
    const [fromX, fromY] = warpPoint(from.x, from.y);
    out.push({ id, owner: state.owner, fromX, fromY });
  }
  return out.length > MAX_CAPTURES ? [] : out;
}

const MAX_NAME = 16;
export const shortName = (name: string): string => (name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name);

/** La taille de l'étiquette pour qu'elle tienne dans ses terres : le nom d'abord, ses troupes juste dessous. */
export function labelFontSize(name: string, label: Pick<OwnerLabel, "width" | "height">): number {
  const byWidth = (label.width * 0.9) / (Math.max(shortName(name).length, 5) * 0.56);
  const byHeight = (label.height * 0.8) / 2.1;
  return Math.max(0.7, Math.min(byWidth, byHeight, 9));
}
