import { describe, expect, it } from "vitest";
import { MAX_BOT_TILES, minimumTroops, simulate, simulateTrace, tileLoss, type CalcInput } from "../../src/lib/calculator";

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

describe("simulateTrace", () => {
  const attack = minimumTroops(base)!.minimum;
  const trace = simulateTrace(attack, base);

  it("part de l'envoi complet, sans case conquise", () => {
    expect(trace[0]).toEqual({ seconds: 0, remaining: attack, conquered: 0 });
  });
  it("arrive au même résultat que la simulation", () => {
    const end = simulate(attack, base);
    const last = trace.at(-1)!;
    expect(last.conquered).toBe(end.conquered);
    expect(last.seconds).toBeCloseTo(end.seconds, 8);
    expect(last.remaining).toBeCloseTo(end.remaining, 8);
  });
  it("avance sans jamais revenir en arrière", () => {
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]!.seconds).toBeGreaterThan(trace[i - 1]!.seconds);
      expect(trace[i]!.conquered).toBeGreaterThan(trace[i - 1]!.conquered);
      expect(trace[i]!.remaining).toBeLessThan(trace[i - 1]!.remaining);
    }
  });
  it("garde un nombre de points raisonnable", () => {
    expect(trace.length).toBeLessThanOrEqual(90);
    expect(simulateTrace(minimumTroops({ ...base, botTiles: 50_000 })!.minimum, { ...base, botTiles: 50_000 }).length).toBeLessThanOrEqual(90);
  });
  it("gère un bot d'une seule case", () => {
    const one = { ...base, botTiles: 1 };
    expect(simulateTrace(1000, one).at(-1)!.conquered).toBe(1);
  });
  it("s'arrête quand l'attaque échoue", () => {
    const failed = simulateTrace(5, base).at(-1)!;
    expect(failed.conquered).toBeLessThan(base.botTiles);
    expect(failed.remaining).toBe(0);
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
