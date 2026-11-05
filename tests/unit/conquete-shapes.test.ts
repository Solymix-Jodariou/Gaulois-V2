import { describe, expect, it } from "vitest";
import { equalEarth, equalEarthInverse, hexArea, hexCorners, WORLD_VIEW } from "../../src/lib/conquete/geo";
import { labelFontSize, outlinesOf, ownerLabels, ownerLayers, parseRings, shortName } from "../../src/lib/conquete/shapes";
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
const inland = map.territories.find((t) => parseRings(t.shape).length === 1 && parseRings(t.shape)[0]!.length === 6 && outlinesOf(map)[t.id - 1]!.sides.every((s) => s.across !== null))!;
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
  it("existent pour chaque territoire et restent dans son hexagone", () => {
    const limit = hexArea(map.hexSize) * 1.02;
    for (const t of map.territories) {
      const rings = parseRings(t.shape);
      expect(rings.length, t.name).toBeGreaterThan(0);
      const total = areaOf(t.shape);
      expect(total, t.name).toBeGreaterThan(0);
      expect(total, t.name).toBeLessThanOrEqual(limit);
      for (const [x, y] of rings.flat()) {
        expect(Math.hypot(x - t.x, y - t.y), t.name).toBeLessThanOrEqual(map.hexSize * 1.01);
      }
    }
  });

  it("s'arrêtent à la côte : Paris n'est pas un hexagone complet, un territoire de l'intérieur l'est", () => {
    const paris = map.territories.find((t) => t.name === "Paris")!;
    expect(areaOf(paris.shape)).toBeLessThan(hexArea(map.hexSize) * 0.98);
    expect(areaOf(inland.shape)).toBeCloseTo(hexArea(map.hexSize), 0);
  });

  it("laissent les grands lacs à découvert : un trou ne se colorie pas", () => {
    const holes = map.territories.filter((t) => parseRings(t.shape).some((ring) => signedArea(ring) * signedArea(parseRings(t.shape)[0]!) < 0));
    expect(holes.length).toBeGreaterThan(0);
  });

  it("deux voisins partagent exactement le même bord : aucune couture entre leurs couleurs", () => {
    const corners = (id: number) => new Set(parseRings(byId.get(id)!.shape).flat().map(([x, y]) => `${x} ${y}`));
    const a = corners(inland.id);
    const shared = [...corners(neighbour)].filter((p) => a.has(p));
    expect(shared.length).toBeGreaterThanOrEqual(2);
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

describe("les terres d'un joueur", () => {
  const edges = (d: string) => (d.match(/M/g) ?? []).length;
  const six = () => hexCorners(inland.x, inland.y, map.hexSize).length;

  it("se bordent seulement là où elles s'arrêtent", () => {
    const alone = ownerLayers(outlinesOf(map), owned([[inland.id, 1]]));
    expect(alone).toHaveLength(1);
    expect(edges(alone[0]!.border)).toBe(six());

    const together = ownerLayers(outlinesOf(map), owned([[inland.id, 1], [neighbour, 1]]));
    expect(together).toHaveLength(1);
    // Deux hexagones collés : douze côtés moins les deux qui se touchent.
    const expected = edges(ownerLayers(outlinesOf(map), owned([[neighbour, 1]]))[0]!.border) + six() - 2;
    expect(edges(together[0]!.border)).toBe(expected);
    expect(together[0]!.fill).toContain(inland.shape);
  });

  it("gardent leur bordure face à un autre joueur", () => {
    const layers = ownerLayers(outlinesOf(map), owned([[inland.id, 1], [neighbour, 2]]));
    expect(layers.map((l) => l.owner).sort()).toEqual([1, 2]);
    expect(edges(layers.find((l) => l.owner === 1)!.border)).toBe(six());
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
