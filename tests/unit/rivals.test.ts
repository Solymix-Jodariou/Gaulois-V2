import { describe, expect, it } from "vitest";
import { rivalSeries } from "../../src/lib/rivals";
import type { LeaderboardEntry, RivalsSnapshot } from "../../src/lib/schemas";

const entry = (clanTag: string, weightedWins: number): LeaderboardEntry => ({
  clanTag,
  games: 10,
  wins: 5,
  losses: 5,
  playerSessions: 20,
  weightedWins,
  weightedLosses: 1,
  weightedWLRatio: 1,
});
const snap = (date: string, clans: [string, number][]): RivalsSnapshot => ({
  date,
  capturedAt: `${date}T10:00:00.000Z`,
  leaderboardEnd: `${date}T09:00:00.000Z`,
  clans: clans.map(([clanTag, weightedWins]) => ({ clanTag, weightedWins })),
});
const list = [entry("UN", 300), entry("GAL", 200), entry("ITA", 150), entry("AST", 100), entry("NU", 50)];

describe("rivalSeries", () => {
  it("prend le clan au-dessus et les deux en dessous, avec leur rang officiel", () => {
    const series = rivalSeries(list, [], "GAL");
    expect(series?.map((s) => [s.clanTag, s.rank])).toEqual([["UN", 1], ["ITA", 3], ["AST", 4]]);
  });
  it("calcule l'écart du clan : positif devant, négatif derrière", () => {
    const series = rivalSeries(list, [snap("2026-11-07", [["UN", 300], ["GAL", 200], ["ITA", 150], ["AST", 100]])], "GAL");
    expect(series?.[0]?.points).toEqual([{ date: "2026-11-07", value: -100 }]);
    expect(series?.[1]?.points).toEqual([{ date: "2026-11-07", value: 50 }]);
  });
  it("suit les voisins d'aujourd'hui sur tous les relevés", () => {
    const series = rivalSeries(list, [snap("2026-11-06", [["GAL", 180], ["ITA", 170]]), snap("2026-11-07", [["GAL", 200], ["ITA", 150]])], "GAL");
    expect(series?.[1]?.points.map((p) => p.value)).toEqual([10, 50]);
  });
  it("laisse un trou si l'un des deux est hors de la liste, jamais un zéro", () => {
    const series = rivalSeries(list, [snap("2026-11-06", [["GAL", 180]]), snap("2026-11-07", [["ITA", 150]])], "GAL");
    expect(series?.[1]?.points.map((p) => p.value)).toEqual([null, null]);
  });
  it("gère le premier et le dernier de la liste", () => {
    expect(rivalSeries(list, [], "UN")?.map((s) => s.clanTag)).toEqual(["GAL", "ITA"]);
    expect(rivalSeries(list, [], "NU")?.map((s) => s.clanTag)).toEqual(["AST"]);
  });
  it("ne renvoie rien pour un clan hors liste, sans tenir compte de la casse", () => {
    expect(rivalSeries(list, [], "ZZZ")).toBeNull();
    expect(rivalSeries(list, [], "gal")?.length).toBe(3);
  });
});
