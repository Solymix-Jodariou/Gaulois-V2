import { describe, expect, it } from "vitest";
import { equalEarth, equalEarthInverse, hexArea, hexCenter, LAND_SIDE_SEGMENTS, landCell, landCellPath, warpPoint, WORLD_VIEW } from "../../src/lib/conquete/geo";
import { capturedLands, labelFontSize, outlinesOf, ownerLabels, ownerLayers, parseRings, shortName } from "../../src/lib/conquete/shapes";
import type { GameMap } from "../../src/lib/conquete/types";
import { MAP } from "../support/game";

const map = MAP as unknown as GameMap;
const byId = new Map(map.territories.map((t) => [t.id, t]));
const owned = (entries: [number, number, number?][]) => new Map(entries.map(([id, owner, garrison]) => [id, { owner, garrison: garrison ?? 100 }]));
const signedArea = (ring: readonly (readonly [number, number])[]) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return sum / 2;
};
/** Les terres moins les lacs : un trou tourne en sens inverse de son contour. */
const areaOf = (shape: string) => Math.abs(parseRings(shape).reduce((sum, ring) => sum + signedArea(ring), 0));

/** Le premier territoire entièrement à l'intérieur des terres, et l'un de ses voisins directs. */
const SIDES = 6 * LAND_SIDE_SEGMENTS;
const inland = map.territories.find((t) => parseRings(t.shape).length === 1 && parseRings(t.shape)[0]!.length === SIDES && outlinesOf(map)[t.id - 1]!.sides.every((s) => s.across !== null))!;
/** La surface de la case entière d'une terre, mer comprise. */
const cellArea = (t: { x: number; y: number }) => Math.abs(signedArea(landCell(t.x, t.y, map.hexSize)));
const outlineOfInland = outlinesOf(map)[inland.id - 1]!;
const neighbour = outlineOfInland.sides[0]!.across!;

describe("la projection inverse", () => {
  it("retrouve les coordonnées de départ, partout sur la carte", () => {
    for (const [lon, lat] of [[0, 0], [2.35, 48.85], [-70, -33], [139.7, 35.7], [179, 70], [-179, -55]] as const) {
      const [x, y] = equalEarth(lon, lat);
      const [backLon, backLat] = equalEarthInverse(x, y);
      expect(backLon, `${lon}`).toBeCloseTo(lon, 6);
      expect(backLat, `${lat}`).toBeCloseTo(lat, 6);
    }
  });

  it("l'image du relief couvre tout le monde projeté", () => {
    const [right] = equalEarth(180, 0);
    const [, top] = equalEarth(0, 90);
    expect(WORLD_VIEW.maxX).toBeGreaterThanOrEqual(right * 100);
    expect(WORLD_VIEW.minX).toBeLessThanOrEqual(-right * 100);
    expect(WORLD_VIEW.maxY).toBeGreaterThanOrEqual(top * 100);
    expect(WORLD_VIEW.minY).toBeLessThanOrEqual(-top * 100);
  });
});

describe("les contours des territoires", () => {
  it("existent pour chaque territoire et restent autour de leur place dans la grille", () => {
    const limit = hexArea(map.hexSize) * 1.75;
    for (const t of map.territories) {
      const rings = parseRings(t.shape);
      expect(rings.length, t.name).toBeGreaterThan(0);
      const total = areaOf(t.shape);
      expect(total, t.name).toBeGreaterThan(0);
      expect(total, t.name).toBeLessThanOrEqual(limit);
      for (const [x, y] of rings.flat()) {
        expect(Math.hypot(x - t.x, y - t.y), t.name).toBeLessThanOrEqual(map.hexSize + 5);
      }
    }
  });

  it("s'arrêtent à la côte : Paris n'occupe pas toute sa case, un territoire de l'intérieur si", () => {
    const paris = map.territories.find((t) => t.name === "Paris")!;
    expect(areaOf(paris.shape)).toBeLessThan(cellArea(paris) * 0.98);
    expect(areaOf(inland.shape) / cellArea(inland)).toBeCloseTo(1, 1);
  });

  it("laissent les grands lacs à découvert : un trou ne se colorie pas", () => {
    const holes = map.territories.filter((t) => parseRings(t.shape).some((ring) => signedArea(ring) * signedArea(parseRings(t.shape)[0]!) < 0));
    expect(holes.length).toBeGreaterThan(0);
  });

  it("deux voisins partagent exactement le même bord : aucune couture entre leurs couleurs", () => {
    const corners = (id: number) => new Set(parseRings(byId.get(id)!.shape).flat().map(([x, y]) => `${x} ${y}`));
    const a = corners(inland.id);
    const shared = [...corners(neighbour)].filter((p) => a.has(p));
    expect(shared.length).toBeGreaterThanOrEqual(LAND_SIDE_SEGMENTS + 1);
  });

  it("notent ce que longe chaque segment, sans oublier un seul anneau", () => {
    for (const t of map.territories) {
      const rings = parseRings(t.shape);
      const codes = t.edges.split("|");
      expect(codes, t.name).toHaveLength(rings.length);
      rings.forEach((ring, i) => {
        expect(codes[i], t.name).toHaveLength(ring.length);
        expect(codes[i], t.name).toMatch(/^[0-5c]+$/);
      });
    }
  });

  it("donnent à un territoire de l'intérieur ses six côtés complets, sans aucune côte", () => {
    const outline = outlinesOf(map)[inland.id - 1]!;
    expect(outline.coast).toBe("");
    for (const { path } of outline.sides) expect((path.match(/M/g) ?? []).length).toBe(LAND_SIDE_SEGMENTS);
  });

  it("trie chaque côté face au bon voisin", () => {
    const outlines = outlinesOf(map);
    for (const outline of outlines) {
      const t = byId.get(outline.id)!;
      for (const { across } of outline.sides) {
        // Un voisin direct sur la grille est toujours un voisin au sens des règles.
        if (across !== null) expect(t.neighbours, `${t.name} et ${across}`).toContain(across);
      }
    }
    // Le côté tourné vers la droite regarde bien le territoire de droite.
    const right = outlineOfInland.sides[0]!.across!;
    expect(byId.get(right)!.x).toBeGreaterThan(inland.x);
    expect(byId.get(right)!.y).toBeCloseTo(inland.y, 1);
  });

  it("le fait une fois pour toutes", () => {
    expect(outlinesOf(map)).toBe(outlinesOf(map));
  });
});

describe("les frontières naturelles", () => {
  const SIZE = map.hexSize;

  it("sont identiques des deux côtés : deux cases voisines ont exactement les mêmes points", () => {
    const [ax, ay] = hexCenter(4, 3, SIZE);
    const [bx, by] = hexCenter(5, 3, SIZE);
    const points = (x: number, y: number) => new Set(landCell(x, y, SIZE).map(([px, py]) => `${px} ${py}`));
    const a = points(ax, ay);
    expect([...points(bx, by)].filter((p) => a.has(p))).toHaveLength(LAND_SIDE_SEGMENTS + 1);
  });

  it("donnent toujours le même résultat, et ne sont plus des hexagones droits", () => {
    expect(landCell(10, 20, SIZE)).toEqual(landCell(10, 20, SIZE));
    expect(landCell(10, 20, SIZE)).toHaveLength(SIDES);
    expect(landCellPath(10, 20, SIZE)).toMatch(/^M.*Z$/);
    const [x, y] = warpPoint(10, 20);
    expect(Math.hypot(x - 10, y - 20)).toBeGreaterThan(0);
    expect(Math.hypot(x - 10, y - 20)).toBeLessThan(5);
  });
});

describe("une terre qui change de main", () => {
  const free = map.territories.find((t) => t.id === neighbour)!;

  it("part des terres voisines du même joueur", () => {
    const before = owned([[inland.id, 1]]);
    const after = owned([[inland.id, 1], [free.id, 1]]);
    const [capture, ...rest] = capturedLands(map, before, after);
    expect(rest).toEqual([]);
    expect(capture).toMatchObject({ id: free.id, owner: 1 });
    expect([capture!.fromX, capture!.fromY]).toEqual([...warpPoint(inland.x, inland.y)]);
  });

  it("se voit aussi quand elle change de propriétaire, mais pas si rien ne change", () => {
    expect(capturedLands(map, owned([[inland.id, 1]]), owned([[inland.id, 2]])).map((c) => c.owner)).toEqual([2]);
    expect(capturedLands(map, owned([[inland.id, 1]]), owned([[inland.id, 1]]))).toEqual([]);
  });

  it("ne fait pas clignoter toute la carte après un rattrapage", () => {
    const many = owned(map.territories.slice(0, 40).map((t) => [t.id, 1]));
    expect(capturedLands(map, owned([]), many)).toEqual([]);
  });
});

describe("les terres d'un joueur", () => {
  const edges = (d: string) => (d.match(/M/g) ?? []).length;

  it("se bordent seulement là où elles s'arrêtent", () => {
    const alone = ownerLayers(outlinesOf(map), owned([[inland.id, 1]]));
    expect(alone).toHaveLength(1);
    expect(edges(alone[0]!.border)).toBe(SIDES);

    const together = ownerLayers(outlinesOf(map), owned([[inland.id, 1], [neighbour, 1]]));
    expect(together).toHaveLength(1);
    // Deux terres collées : tous leurs segments, moins ceux de la frontière qu'elles partagent, de chaque côté.
    const expected = edges(ownerLayers(outlinesOf(map), owned([[neighbour, 1]]))[0]!.border) + SIDES - 2 * LAND_SIDE_SEGMENTS;
    expect(edges(together[0]!.border)).toBe(expected);
    expect(together[0]!.fill).toContain(inland.shape);
  });

  it("gardent leur bordure face à un autre joueur", () => {
    const layers = ownerLayers(outlinesOf(map), owned([[inland.id, 1], [neighbour, 2]]));
    expect(layers.map((l) => l.owner).sort()).toEqual([1, 2]);
    expect(edges(layers.find((l) => l.owner === 1)!.border)).toBe(SIDES);
  });

  it("ne dessinent rien sans propriétaire", () => {
    expect(ownerLayers(outlinesOf(map), owned([]))).toEqual([]);
  });
});

describe("l'étiquette d'un joueur", () => {
  it("se pose sur son plus grand ensemble, et compte toutes ses troupes", () => {
    const far = map.territories.find((t) => Math.abs(t.x - inland.x) > 60)!;
    const labels = ownerLabels(map, owned([[inland.id, 1, 300], [neighbour, 1, 200], [far.id, 1, 50]]));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ owner: 1, territories: 3, garrison: 550 });
    expect([inland.id, neighbour]).toContain(labels[0]!.anchor);
    expect(Math.hypot(labels[0]!.x - inland.x, labels[0]!.y - inland.y)).toBeLessThan(map.hexSize * 2);
  });

  it("un joueur par étiquette", () => {
    const labels = ownerLabels(map, owned([[inland.id, 1], [neighbour, 2]]));
    expect(labels.map((l) => l.owner).sort()).toEqual([1, 2]);
  });

  it("tient dans ses terres, sans jamais devenir illisible ni énorme", () => {
    const small = { width: 8.8, height: 10 };
    expect(labelFontSize("Astra", small)).toBeLessThanOrEqual(small.height);
    expect(labelFontSize("Astra", small) * "Astra".length * 0.56).toBeLessThanOrEqual(small.width);
    expect(labelFontSize("Un pseudo vraiment très très long", small)).toBeGreaterThanOrEqual(0.7);
    expect(labelFontSize("A", { width: 400, height: 300 })).toBe(9);
    expect(shortName("Un pseudo vraiment très très long")).toHaveLength(16);
    expect(shortName("Astra")).toBe("Astra");
  });
});
