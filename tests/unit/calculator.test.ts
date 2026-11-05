import { describe, expect, it } from "vitest";
import { MAX_BOT_TILES, minimumTroops, simulate, tileLoss, type CalcInput } from "../../src/lib/calculator";

const base: CalcInput = { botTroops: 10_000, botTiles: 1000, terrain: "plains", border: 50, myTiles: 20_000 };

describe("tileLoss", () => {
  it("applique la formule du jeu sur un cas calculé à la main", () => {
    // 80 × 0,7 × 0,6 × (0,463 × 0,999198 × 0,9999998 + 0,0039 × 10) = 16,855
    expect(tileLoss(20_000, 10_000, 1000, 20_000, "plains")).toBeCloseTo(16.855, 2);
  });

  it("borne le ratio troupes du bot / attaque entre 0,6 et 2", () => {
    const low = tileLoss(1_000_000, 10_000, 1000, 20_000, "plains");
    expect(tileLoss(100_000, 10_000, 1000, 20_000, "plains")).toBeCloseTo(low, 8);
    const high = tileLoss(100, 10_000, 1000, 20_000, "plains");
    expect(high / low).toBeCloseTo(2 / 0.6, 8);
  });

  it("coûte 25 % de plus en colline et 50 % de plus en montagne qu'en plaine", () => {
    const plains = tileLoss(20_000, 10_000, 1000, 20_000, "plains");
    expect(tileLoss(20_000, 10_000, 1000, 20_000, "highland") / plains).toBeCloseTo(1.25, 8);
    expect(tileLoss(20_000, 10_000, 1000, 20_000, "mountain") / plains).toBeCloseTo(1.5, 8);
  });

  it("réduit les pertes pour un très grand attaquant", () => {
    expect(tileLoss(20_000, 10_000, 1000, 2_000_000, "plains")).toBeLessThan(tileLoss(20_000, 10_000, 1000, 1000, "plains"));
  });
});

describe("minimumTroops", () => {
  it("renvoie le plus petit envoi qui réussit", () => {
    const r = minimumTroops(base);
    expect(r).not.toBeNull();
    expect(simulate(r!.minimum, base).success).toBe(true);
    expect(simulate(r!.minimum - 1, base).success).toBe(false);
    expect(r!.multiple).toBeCloseTo(r!.minimum / base.botTroops, 8);
  });

  it("ordonne plaine < colline < montagne", () => {
    const m = (terrain: CalcInput["terrain"]) => minimumTroops({ ...base, terrain })!.minimum;
    expect(m("plains")).toBeLessThan(m("highland"));
    expect(m("highland")).toBeLessThan(m("mountain"));
  });

  it("dépend plus de la taille du bot que de ses troupes", () => {
    const plus4xTiles = minimumTroops({ ...base, botTiles: 4000 })!.minimum;
    const plus4xTroops = minimumTroops({ ...base, botTroops: 40_000 })!.minimum;
    expect(plus4xTiles).toBeGreaterThan(plus4xTroops);
  });

  it("ne dépend pas de la frontière, qui ne change que la durée", () => {
    const narrow = minimumTroops({ ...base, border: 10 })!;
    const wide = minimumTroops({ ...base, border: 200 })!;
    expect(narrow.minimum).toBe(wide.minimum);
    expect(narrow.seconds).toBeGreaterThan(wide.seconds);
  });

  it.each([
    ["troupes nulles", { botTroops: 0 }],
    ["taille nulle", { botTiles: 0 }],
    ["taille décimale", { botTiles: 1.5 }],
    ["taille excessive", { botTiles: MAX_BOT_TILES + 1 }],
    ["frontière nulle", { border: 0 }],
    ["territoire nul", { myTiles: 0 }],
    ["valeur non numérique", { botTroops: Number.NaN }],
  ])("refuse les entrées invalides : %s", (_label, patch) => {
    expect(minimumTroops({ ...base, ...patch })).toBeNull();
  });
});
