import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEX_DIRECTIONS, KM2_PER_UNIT, equalEarth, hexArea, hexAt, hexCenter, hexCorners, pointInRings } from "../../src/lib/conquete/geo";
import { NAME_OVERRIDES } from "../../scripts/conquete-map-names";
import { MAP } from "../support/game";

const SQL = readFileSync("supabase/migrations/20261105000700_carte_v1.sql", "utf8");
const byId = new Map(MAP.territories.map((t) => [t.id, t]));

describe("la projection", () => {
  it("donne les valeurs publiées d'Equal Earth", () => {
    expect(equalEarth(0, 0)[0]).toBe(0);
    expect(equalEarth(180, 0)[0]).toBeCloseTo(Math.PI / ((Math.sqrt(3) / 2) * 1.340264), 6);
    expect(equalEarth(0, 90)[1]).toBeCloseTo(1.3173, 3);
  });

  it("conserve les surfaces : c'est ce qui rend les hexagones équitables", () => {
    /** Surface projetée d'un carré de 1° de côté, comparée à sa vraie surface sur la sphère. */
    const scale = (lon: number, lat: number) => {
      const d = 0.5;
      const [ax, ay] = equalEarth(lon, lat);
      const [bx, by] = equalEarth(lon + d, lat);
      const [cx, cy] = equalEarth(lon + d, lat + d);
      const [dx, dy] = equalEarth(lon, lat + d);
      const projected = Math.abs((bx - ax) * (dy - ay) - (by - ay) * (dx - ax) + (cx - bx) * (cy - by) - (cy - by) * (cx - bx)) ;
      const rad = (x: number) => (x * Math.PI) / 180;
      const real = rad(d) * (Math.sin(rad(lat + d)) - Math.sin(rad(lat)));
      return projected / real;
    };
    for (const [lon, lat] of [[0, 0], [2, 48], [100, 60], [-70, -40], [130, 20]] as const) {
      expect(scale(lon, lat), `${lon}, ${lat}`).toBeCloseTo(1, 1);
    }
  });
});

describe("la grille", () => {
  it("retrouve l'hexagone d'un point", () => {
    for (const [q, r] of [[0, 0], [3, -2], [-5, 7], [12, 4]] as const) {
      const [x, y] = hexCenter(q, r, 0.05);
      expect(hexAt(x, y, 0.05)).toEqual({ q, r });
      expect(hexAt(x + 0.02, y - 0.01, 0.05)).toEqual({ q, r });
    }
  });

  it("place les six voisins à la même distance", () => {
    const [cx, cy] = hexCenter(0, 0, 1);
    for (const [q, r] of HEX_DIRECTIONS) {
      const [x, y] = hexCenter(q, r, 1);
      expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(Math.sqrt(3), 8);
    }
  });

  it("dessine des hexagones réguliers", () => {
    const corners = hexCorners(0, 0, 2);
    expect(corners).toHaveLength(6);
    for (const [x, y] of corners) expect(Math.hypot(x, y)).toBeCloseTo(2, 8);
  });

  it("sait si un point est dans un polygone à trou", () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][];
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6]] as [number, number][];
    expect(pointInRings(1, 1, [outer, hole])).toBe(true);
    expect(pointInRings(5, 5, [outer, hole])).toBe(false);
    expect(pointInRings(11, 5, [outer, hole])).toBe(false);
  });
});

describe("la carte générée", () => {
  it("compte environ 500 territoires de même surface", () => {
    expect(MAP.territories.length).toBeGreaterThan(450);
    expect(MAP.territories.length).toBeLessThan(600);
    const km2 = hexArea(MAP.hexSize / 100) * KM2_PER_UNIT;
    expect(Math.abs(km2 - 270_000) / 270_000).toBeLessThan(0.01);
    expect(MAP.source).toMatch(/Natural Earth/);
  });

  it("numérote les territoires sans trou", () => {
    expect(MAP.territories.map((t) => t.id)).toEqual(MAP.territories.map((_, i) => i + 1));
  });

  it("donne à chacun un nom unique et non vide", () => {
    const names = MAP.territories.map((t) => t.name);
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("n'utilise aucun des noms écartés", () => {
    const names = new Set(MAP.territories.map((t) => t.name));
    for (const removed of Object.keys(NAME_OVERRIDES)) {
      if (NAME_OVERRIDES[removed] !== removed) expect(names.has(removed), removed).toBe(false);
    }
    for (const sensitive of ["Kiev", "Kharkiv", "Khartoum", "Tel Aviv", "Sanaa", "Kaboul", "Alep", "Mogadiscio", "El Fasher", "Taipei"]) {
      expect(names.has(sensitive), sensitive).toBe(false);
    }
  });

  it("garde des voisins réciproques, valides et différents de soi", () => {
    for (const t of MAP.territories) {
      expect(t.neighbours.length, t.name).toBeGreaterThan(0);
      expect(new Set(t.neighbours).size).toBe(t.neighbours.length);
      for (const n of t.neighbours) {
        expect(n).not.toBe(t.id);
        expect(byId.get(n)?.neighbours, `${t.name} et ${n}`).toContain(t.id);
      }
    }
  });

  it("relie tout le monde : depuis n'importe où, on peut atteindre toute la carte", () => {
    const seen = new Set<number>([1]);
    const stack = [1];
    while (stack.length > 0) {
      for (const n of byId.get(stack.pop()!)!.neighbours) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    expect(seen.size).toBe(MAP.territories.length);
  });

  it("déclare ses routes de haute mer, Béring compris", () => {
    for (const { a, b } of MAP.routes) expect(byId.get(a)!.neighbours).toContain(b);
    expect(MAP.routes.filter((r) => r.wrap)).toHaveLength(1);
  });

  it("répartit le relief : surtout des plaines, un peu de montagne", () => {
    const share = (terrain: string) => MAP.territories.filter((t) => t.terrain === terrain).length / MAP.territories.length;
    expect(share("plains")).toBeGreaterThan(0.45);
    expect(share("highland")).toBeGreaterThan(0.2);
    expect(share("mountain")).toBeGreaterThan(0.08);
    expect(share("mountain")).toBeLessThan(0.25);
  });

  it("place les grandes villes sur des territoires distincts", () => {
    const names = new Set(MAP.territories.map((t) => t.name));
    for (const city of ["Paris", "Londres", "Madrid", "Berlin", "Rome", "Moscou", "Tokyo", "Pékin", "Le Caire", "Washington"]) {
      expect(names.has(city), city).toBe(true);
    }
  });

  it("le fichier du site et celui du serveur décrivent la même carte", () => {
    const rows = [...SQL.matchAll(/\('v1', (\d+), '((?:[^']|'')*)', '(\w+)', '\{([\d,]*)\}'\)/g)];
    expect(rows).toHaveLength(MAP.territories.length);
    for (const [, id, name, terrain, neighbours] of rows) {
      const t = byId.get(Number(id))!;
      expect(name!.replaceAll("''", "'")).toBe(t.name);
      expect(terrain).toBe(t.terrain);
      expect(neighbours!.split(",").map(Number)).toEqual(t.neighbours);
    }
  });
});
