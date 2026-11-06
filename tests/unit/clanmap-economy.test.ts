import { describe, expect, it } from "vitest";
import {
  capsForNeutralPixels,
  capsToTroops,
  expansionOrder,
  neutralPixelsFor,
  objectiveFor,
  projectRank,
  type Standing,
} from "../../src/lib/clanmap/economy";
import { findMoments, type MomentFrame } from "../../src/lib/clanmap/moments";
import { MapHeroes, Meta } from "../../src/lib/schemas";

const n = (value: number) => new Intl.NumberFormat("fr-FR").format(value);
const clan = (tag: string, pixels: number): Standing => ({ tag, color: null, pixels });
const standings = [clan("LUX", 380000), clan("UN", 330000), clan("AST", 98000), clan("GAL", 91000), clan("ITA", 67000)];

describe("fichiers du clan et de la collecte", () => {
  it("accepte un classement de donateurs vide ou rempli", () => {
    expect(MapHeroes.safeParse({ updatedOn: null, donors: [], highlights: [] }).success).toBe(true);
    const filled = { updatedOn: "2026-11-05", donors: [{ player: "Alpha", caps: 1200 }], highlights: [{ title: "Titre", player: "Alpha" }] };
    expect(MapHeroes.safeParse(filled).success).toBe(true);
  });

  it("refuse un don nul, négatif ou sans joueur", () => {
    const withDonor = (donor: unknown) => ({ updatedOn: null, donors: [donor], highlights: [] });
    expect(MapHeroes.safeParse(withDonor({ player: "Alpha", caps: 0 })).success).toBe(false);
    expect(MapHeroes.safeParse(withDonor({ player: "Alpha", caps: -5 })).success).toBe(false);
    expect(MapHeroes.safeParse(withDonor({ player: "", caps: 5 })).success).toBe(false);
  });

  it("lit un meta.json d'avant la carte sans perdre son état", () => {
    const empty = { lastSuccessAt: null, lastErrorAt: null, lastError: null };
    const old = { lastRunAt: null, leaderboard: empty, members: empty, sessions: { ...empty, completeThrough: "2026-11-03", coveredUntil: null } };
    const parsed = Meta.parse(old);
    expect(parsed.sessions.completeThrough).toBe("2026-11-03");
    expect(parsed.clanmap).toEqual(empty);
  });
});

describe("coûts de la carte", () => {
  it("applique les règles relevées dans le code de la carte", () => {
    expect(capsToTroops(10)).toBe(1000);
    expect(neutralPixelsFor(1000)).toBe(1);
    expect(neutralPixelsFor(1999)).toBe(1);
    expect(capsForNeutralPixels(6661)).toBe(66610);
  });

  it("ne donne jamais un résultat négatif", () => {
    expect(capsToTroops(-5)).toBe(0);
    expect(neutralPixelsFor(-1)).toBe(0);
    expect(capsForNeutralPixels(-1)).toBe(0);
  });
});

describe("objectif du clan", () => {
  it("indique le clan à dépasser et ce qu'il manque", () => {
    expect(objectiveFor(standings, "GAL")).toMatchObject({ rank: 4, gap: 7001, lead: 24000 });
    expect(objectiveFor(standings, "GAL")?.above?.tag).toBe("AST");
    expect(objectiveFor(standings, "GAL")?.below?.tag).toBe("ITA");
  });

  it("gère le premier, le dernier et un clan absent", () => {
    expect(objectiveFor(standings, "LUX")).toMatchObject({ rank: 1, above: null, gap: null });
    expect(objectiveFor(standings, "ITA")).toMatchObject({ rank: 5, below: null, lead: null });
    expect(objectiveFor(standings, "ZZZ")).toBeNull();
  });
});

describe("projection du rang", () => {
  it("ne change rien sans pixel supplémentaire", () => {
    expect(projectRank(standings, "GAL", 0)).toMatchObject({ rank: 4, passed: [], missing: 7001 });
  });

  it("garde le rang tant que le clan devant n'est pas dépassé", () => {
    expect(projectRank(standings, "GAL", 7000)).toMatchObject({ rank: 4, passed: [], missing: 1 });
  });

  it("passe devant dès le pixel suivant", () => {
    const p = projectRank(standings, "GAL", 7001);
    expect(p).toMatchObject({ rank: 3, passed: ["AST"], missing: 232000 });
    expect(p?.next?.tag).toBe("UN");
  });

  it("peut dépasser plusieurs clans et prendre la tête", () => {
    const p = projectRank(standings, "GAL", 400000);
    expect(p).toMatchObject({ rank: 1, passed: ["AST", "UN", "LUX"], next: null, missing: null });
  });

  it("renvoie null pour un clan absent de la carte", () => {
    expect(projectRank(standings, "ZZZ", 10)).toBeNull();
  });
});

describe("simulation d'expansion", () => {
  // Grille 5 × 3 : GAL (1) à gauche, un autre clan (2), une case de mer (index 13).
  const owners = Uint16Array.from([1, 0, 0, 0, 2, 1, 0, 0, 0, 2, 1, 0, 0, 0, 2]);
  const land = (cell: number) => cell !== 13;

  it("avance depuis la frontière, sur les terres neutres seulement", () => {
    const order = [...expansionOrder(owners, land, 1, 5, 3, 100)];
    expect(order.slice(0, 3).sort((a, b) => a - b)).toEqual([1, 6, 11]);
    expect(order).not.toContain(13);
    expect(order).not.toContain(4);
    expect(order).not.toContain(0);
    expect(new Set(order).size).toBe(order.length);
    expect(order).toHaveLength(8);
  });

  it("respecte la limite demandée", () => {
    expect(expansionOrder(owners, land, 1, 5, 3, 2)).toHaveLength(2);
  });

  it("ne traverse pas le bord de la carte", () => {
    const wide = Uint16Array.from([0, 0, 1, 0, 0, 0]);
    const order = [...expansionOrder(wide, () => true, 1, 3, 2, 10)];
    expect(order.slice(0, 2).sort((a, b) => a - b)).toEqual([1, 5]);
    expect(order).toHaveLength(5);
  });

  it("reste vide pour un clan sans territoire", () => {
    expect(expansionOrder(new Uint16Array(4), () => true, 1, 2, 2, 10)).toHaveLength(0);
  });
});

describe("grands moments", () => {
  /** Une image par ligne : [pixels de GAL, rang]. */
  const frames = (rows: [number, number | null][]): MomentFrame[] => rows.map(([gal, rank], i) => ({ ev: (i + 1) * 5000, gal, rank }));

  it("raconte le sommet, la chute et la remontée sans rien inventer", () => {
    const rows: [number, number | null][] = [];
    for (let i = 0; i < 100; i++) {
      let rank = 2;
      if (i < 5) rank = 5;
      if (i >= 30) rank = 8;
      if (i >= 70) rank = 5;
      rows.push([100 + i * 120, rank]);
    }
    const titles = findMoments(frames(rows)).map((m) => m.title);
    expect(titles[0]).toBe("Premier pixel de GAL");
    expect(titles).toContain("GAL atteint la 2e place");
    expect(titles).toContain("GAL recule à la 8e place");
    expect(titles).toContain("GAL remonte à la 5e place");
    expect(titles).toContain(`GAL franchit ${n(10000)} pixels`);
    expect(titles.at(-1)).toBe(`Aujourd'hui : ${n(11980)} pixels, 5e place`);
  });

  it("trouve la plus grande poussée et le plus dur recul", () => {
    const rows: [number, number | null][] = [];
    for (let i = 0; i < 200; i++) rows.push([100 + i, 3]);
    rows[80] = [5000, 3];
    for (let i = 81; i < 150; i++) rows[i] = [5000, 3];
    for (let i = 150; i < 200; i++) rows[i] = [1000, 3];
    const moments = findMoments(frames(rows));
    expect(moments.find((m) => m.kind === "push")).toMatchObject({ frame: 81, title: `La plus grande poussée : +${n(4821)} pixels` });
    expect(moments.find((m) => m.kind === "loss")?.frame).toBe(151);
  });

  it("garde un écart entre deux moments et priorise le plus important", () => {
    const moments = findMoments(frames([[20000, 1], [26000, 1], [27000, 1], [28000, 1], [29000, 1], [30000, 1], [31000, 1], [32000, 1]]));
    for (let i = 1; i < moments.length; i++) {
      expect(moments[i]!.frame - moments[i - 1]!.frame).toBeGreaterThanOrEqual(3);
    }
    expect(moments[0]?.kind).toBe("first");
    expect(moments.at(-1)?.kind).toBe("now");
  });

  it("ne raconte rien si GAL n'a jamais eu de pixel", () => {
    expect(findMoments(frames([[0, null], [0, null]]))).toEqual([]);
  });

  it("ne parle pas d'aujourd'hui si GAL a tout perdu", () => {
    const moments = findMoments(frames([[10, 1], [10, 1], [10, 1], [10, 1], [0, null]]));
    expect(moments.some((m) => m.kind === "now")).toBe(false);
  });

  it("note le numéro d'événement de chaque moment", () => {
    const moments = findMoments(frames([[0, null], [50, 1]]));
    expect(moments[0]).toMatchObject({ frame: 2, event: 10000 });
  });
});
