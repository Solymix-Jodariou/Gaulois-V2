import { describe, expect, it } from "vitest";
import { GROWTH_REFERENCE_CAPACITY, gainVersusPeak, peakPercent, troopGainPerTick } from "../../src/lib/growth";

describe("troopGainPerTick", () => {
  it("applique la formule du jeu sur un cas calculé à la main", () => {
    // (10 + 420 000^0,73 ÷ 4) × (1 − 0,42) = 1 852
    expect(troopGainPerTick(420_000, 1_000_000)).toBeCloseTo(1852.3, 0);
  });

  it("ne gagne plus rien à pleine capacité", () => {
    expect(troopGainPerTick(100_000, 100_000)).toBe(0);
  });

  it("refuse les valeurs impossibles plutôt que d'inventer un gain", () => {
    expect(troopGainPerTick(10, 0)).toBe(0);
    expect(troopGainPerTick(-1, 100)).toBe(0);
    expect(troopGainPerTick(200, 100)).toBe(0);
    expect(troopGainPerTick(Number.NaN, 100)).toBe(0);
  });
});

describe("peakPercent", () => {
  it("retrouve les pics de la légende du guide du clan", () => {
    const peaks = [2_500, 10_000, 25_000, 100_000, 250_000, 1_000_000, 2_500_000].map((c) => Math.round(peakPercent(c)));
    expect(peaks).toEqual([36, 40, 41, 42, 42, 42, 42]);
  });
});

describe("gainVersusPeak", () => {
  it("vaut 100 % au pic", () => {
    expect(gainVersusPeak(peakPercent(GROWTH_REFERENCE_CAPACITY), GROWTH_REFERENCE_CAPACITY)).toBeCloseTo(100, 8);
  });

  it("donne les ordres de grandeur annoncés dans le chapitre, dès 100 000 de capacité", () => {
    for (const capacity of [100_000, 1_000_000, 2_500_000]) {
      expect(Math.round(gainVersusPeak(35, capacity))).toBe(98);
      expect(Math.round(gainVersusPeak(50, capacity))).toBe(98);
      expect(Math.round(gainVersusPeak(80, capacity))).toBe(55);
    }
  });
});
