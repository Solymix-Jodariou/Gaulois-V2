import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, capacity, neutralCost, ranked, regenStep, resolveAttack, settle, startingTroops, troopsToWin } from "../../src/lib/conquete/rules";

/** Une journée sans rien dépenser, heure par heure. */
const afterDays = (troops: number, days: number, cap: number) => settle(troops, days * 24 * 3_600_000, cap).troops;

describe("la capacité, d'après maxTroops d'OpenFront", () => {
  it("donne la valeur d'OpenFront sans territoire ni capsule : 2 × 50 000", () => {
    expect(capacity(0, 0)).toBe(100_000);
  });

  it("suit `2 × (tuiles^0,6 × 1000 + 50 000)`, avec 100 tuiles par territoire", () => {
    expect(capacity(1, 0)).toBeCloseTo(2 * (Math.pow(100, 0.6) * 1000 + 50_000), 6);
    expect(Math.round(capacity(5, 0))).toBe(183_255);
    expect(Math.round(capacity(20, 0))).toBe(291_270);
  });

  it("ajoute `2000 × √capsules` : les chiffres de la proposition validée", () => {
    expect(Math.round(capacity(5, 100))).toBe(203_255);
    expect(Math.round(capacity(5, 1000))).toBe(246_501);
    expect(Math.round(capacity(5, 10_000))).toBe(383_255);
    expect(Math.round(capacity(5, 100_000))).toBe(815_711);
    expect(Math.round(capacity(5, 500_000))).toBe(1_597_469);
  });

  it("a des rendements décroissants : dix fois plus de capsules ne donnent jamais dix fois plus", () => {
    for (const caps of [100, 1000, 10_000, 100_000]) {
      const gain = capacity(5, caps) - capacity(5, 0);
      const gainTen = capacity(5, caps * 10) - capacity(5, 0);
      expect(gainTen / gain).toBeCloseTo(Math.sqrt(10), 5);
    }
  });

  it("laisse une base à tout membre validé : personne n'est à zéro", () => {
    expect(capacity(0, 0)).toBeGreaterThan(0);
    expect(startingTroops(0)).toBe(25_000);
  });

  it("ne compte jamais une capsule négative", () => {
    expect(capacity(1, -500)).toBe(capacity(1, 0));
  });
});

describe("la régénération, d'après troopIncreaseRate d'OpenFront", () => {
  it("suit `(10 + troupes^0,73 ÷ 4) × (1 − troupes ÷ max)`", () => {
    const cap = capacity(5, 0);
    expect(regenStep(25_000, cap)).toBeCloseTo((10 + Math.pow(25_000, 0.73) / 4) * (1 - 25_000 / cap), 8);
  });

  it("démarre même à zéro, et s'arrête à la capacité", () => {
    expect(regenStep(0, 100_000)).toBe(10);
    expect(regenStep(100_000, 100_000)).toBe(0);
  });

  it("fait fondre doucement une réserve au-dessus de sa capacité, comme dans le jeu", () => {
    expect(regenStep(120_000, 100_000)).toBeLessThan(0);
  });

  it("donne les chiffres de la proposition validée, à 25 troupes près (arrondi à chaque calcul)", () => {
    const table = [
      [0, 25_000, 34_384, 107_798],
      [1000, 40_811, 53_450, 145_556],
      [10_000, 75_000, 93_566, 221_760],
      [100_000, 183_114, 216_757, 441_030],
      [500_000, 378_553, 434_242, 801_295],
    ] as const;
    for (const [caps, start, day1, day7] of table) {
      expect(startingTroops(caps)).toBe(start);
      const cap = capacity(5, caps);
      expect(Math.abs(afterDays(start, 1, cap) - day1)).toBeLessThanOrEqual(25);
      expect(Math.abs(afterDays(start, 7, cap) - day7)).toBeLessThanOrEqual(25);
    }
  });

  it("n'accorde rien avant une heure pleine", () => {
    expect(settle(1000, 59 * 60_000, 100_000)).toEqual({ troops: 1000, steps: 0 });
    expect(settle(1000, 60 * 60_000, 100_000).steps).toBe(1);
  });

  it("reste à l'équilibre près de la capacité, même après des mois d'absence", () => {
    const cap = capacity(5, 0);
    const { troops } = settle(25_000, 365 * 24 * 3_600_000, cap);
    expect(troops).toBeLessThanOrEqual(cap);
    expect(troops).toBeGreaterThan(cap * 0.99);
  });

  it("ne descend jamais sous zéro", () => {
    expect(settle(1, 3_600_000, 0.5).troops).toBeGreaterThanOrEqual(0);
  });
});

describe("la terre libre", () => {
  it("coûte `mag ÷ 5` par tuile", () => {
    expect(neutralCost("plains")).toBe(1600);
    expect(neutralCost("highland")).toBe(2000);
    expect(neutralCost("mountain")).toBe(2400);
  });
});

describe("le combat, d'après attackLogic d'OpenFront", () => {
  it.each([
    ["plains", 10_000, 15_000, true, 12_869, 2131],
    ["plains", 10_000, 12_000, false, 16_087, 2540],
    ["mountain", 10_000, 15_000, false, 19_304, 2230],
    ["mountain", 10_000, 20_000, true, 17_374, 2626],
    ["plains", 50_000, 70_000, true, 58_360, 11_640],
    ["plains", 50_000, 40_000, false, 102_130, 30_417],
    ["plains", 1400, 5000, true, 3533, 1467],
    ["plains", 1400, 3000, false, 3533, 211],
  ] as const)("%s, garnison %i, envoyés %i : les chiffres de la proposition validée", (terrain, garrison, sent, won, losses, after) => {
    const result = resolveAttack(sent, garrison, terrain);
    expect(result.won).toBe(won);
    expect(Math.round(result.losses)).toBe(losses);
    expect(result.garrisonAfter).toBe(after);
  });

  it("borne le rapport entre 0,6 et 2, comme dans le jeu", () => {
    expect(resolveAttack(1_000_000, 100, "plains").ratio).toBe(0.6);
    expect(resolveAttack(1, 1_000_000, "plains").ratio).toBe(2);
    expect(resolveAttack(1000, 1000, "plains").ratio).toBe(1);
  });

  it("récompense le surnombre : plus on envoie, moins on perd", () => {
    const small = resolveAttack(13_000, 10_000, "plains").losses;
    const big = resolveAttack(16_000, 10_000, "plains").losses;
    expect(big).toBeLessThan(small);
  });

  it("le relief protège : même garnison, même envoi, plus de pertes en montagne", () => {
    const of = (terrain: "plains" | "highland" | "mountain") => resolveAttack(20_000, 10_000, terrain).losses;
    expect(of("highland") / of("plains")).toBeCloseTo(1.25, 8);
    expect(of("mountain") / of("plains")).toBeCloseTo(1.5, 8);
  });

  it("une garnison retranchée vaut mieux qu'une garnison sans bonus", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
    config.combat.garrisonBonus = 1;
    expect(troopsToWin(50_000, "plains", config) / 50_000).toBeCloseTo(0.62, 1);
    expect(troopsToWin(50_000, "plains") / 50_000).toBeCloseTo(1.28, 1);
  });

  it("il faut de 1,3 à 1,7 fois une garnison de 10 000 ou plus, selon le terrain", () => {
    for (const garrison of [10_000, 50_000, 200_000]) {
      for (const terrain of ["plains", "highland", "mountain"] as const) {
        const factor = troopsToWin(garrison, terrain) / garrison;
        expect(factor, `${terrain}, ${garrison}`).toBeGreaterThan(1.25);
        expect(factor, `${terrain}, ${garrison}`).toBeLessThan(1.8);
      }
    }
  });

  it("troopsToWin donne exactement le seuil de la victoire", () => {
    for (const garrison of [1, 100, 1400, 10_000, 123_456]) {
      for (const terrain of ["plains", "highland", "mountain"] as const) {
        const threshold = troopsToWin(garrison, terrain);
        expect(resolveAttack(threshold, garrison, terrain).won).toBe(true);
        if (threshold > 1) expect(resolveAttack(threshold - 1, garrison, terrain).won).toBe(false);
      }
    }
  });

  it("ne laisse jamais une garnison à zéro ni des survivants négatifs", () => {
    for (const sent of [1, 7, 100, 1000, 5000, 7584, 100_000]) {
      for (const garrison of [1, 2, 3, 500, 5000, 100_000]) {
        const r = resolveAttack(sent, garrison, "plains");
        expect(r.garrisonAfter).toBeGreaterThanOrEqual(1);
        expect(r.survivors).toBeGreaterThanOrEqual(0);
        if (r.won) {
          expect(r.survivors).toBeLessThanOrEqual(sent);
          expect(r.garrisonAfter).toBe(r.survivors);
        } else {
          expect(r.survivors).toBe(0);
          expect(r.garrisonAfter).toBeLessThanOrEqual(garrison);
        }
      }
    }
  });

  it("passe sans saut de l'échec à la victoire : juste avant, la garnison est presque détruite", () => {
    const garrison = 10_000;
    const threshold = troopsToWin(garrison, "plains");
    const justBefore = resolveAttack(threshold - 1, garrison, "plains");
    expect(justBefore.garrisonAfter).toBeLessThan(garrison * 0.01);
    const justAfter = resolveAttack(threshold, garrison, "plains");
    expect(justAfter.survivors).toBeLessThan(garrison * 0.01);
  });
});

describe("l'équité entre un petit joueur et un gros donneur", () => {
  it("100 000 capsules donnent 4,5 fois la capacité, pas 100 000 fois", () => {
    expect(capacity(5, 100_000) / capacity(5, 0)).toBeCloseTo(4.45, 1);
  });

  it("un joueur sans capsule peut prendre une garnison de 15 000 en moins de 2 jours de régénération", () => {
    const cap = capacity(5, 0);
    const reserve = cap * 0.4;
    const gain = afterDays(reserve, 1, cap) - reserve;
    expect(troopsToWin(15_000, "plains") / gain).toBeLessThan(2);
  });
});

describe("les places", () => {
  it("deux joueurs à égalité partagent la même place", () => {
    const rows = ranked([{ n: "a", v: 5 }, { n: "b", v: 9 }, { n: "c", v: 5 }, { n: "d", v: 1 }], (r) => r.v);
    expect(rows.map((r) => [r.n, r.rank])).toEqual([["b", 1], ["a", 2], ["c", 2], ["d", 4]]);
  });
});
