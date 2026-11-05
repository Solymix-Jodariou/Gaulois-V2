import { describe, expect, it } from "vitest";
import {
  bestSlots,
  bucketize,
  buildHeatmap,
  dailySeries,
  filterRange,
  groupStats,
  mergeSessions,
} from "../../src/lib/sessions";
import { parisParts } from "../../src/lib/time";
import type { StoredSession } from "../../src/lib/schemas";

const s = (gameId: string, gameStart: string, hasWon = true, clanPlayerCount = 2): StoredSession => ({
  gameId,
  gameStart,
  hasWon,
  clanPlayerCount,
  numTeams: 2,
  playerTeams: "2",
  totalPlayerCount: 10,
  score: 1,
});

describe("parisParts", () => {
  it("bascule au jour suivant le soir UTC", () => {
    expect(parisParts("2026-11-04T23:30:00Z")).toEqual({ date: "2026-11-05", hour: 0, weekday: 3 });
  });
  it("gère l'heure d'été", () => expect(parisParts("2026-07-14T22:30:00Z").date).toBe("2026-07-15"));
  it("gère le passage à l'heure d'hiver", () => {
    expect(parisParts("2026-10-25T00:30:00Z").hour).toBe(2);
    expect(parisParts("2026-10-25T01:30:00Z").hour).toBe(2);
    expect(parisParts("2026-10-25T02:30:00Z").hour).toBe(3);
  });
});

describe("mergeSessions", () => {
  it("déduplique par gameId et garde la dernière lecture", () => {
    const merged = mergeSessions([s("a", "2026-11-01T10:00:00.000Z", false)], [s("a", "2026-11-01T10:00:00.000Z", true), s("b", "2026-11-01T09:00:00.000Z")]);
    expect(merged.map((x) => x.gameId)).toEqual(["b", "a"]);
    expect(merged.find((x) => x.gameId === "a")?.hasWon).toBe(true);
  });
  it("est idempotente", () => {
    const list = [s("a", "2026-11-01T10:00:00.000Z")];
    expect(mergeSessions(list, list)).toEqual(list);
  });
});

describe("dailySeries", () => {
  it("regroupe par jour de Paris et compte victoires et défaites", () => {
    const days = dailySeries(
      [s("a", "2026-11-01T22:59:00.000Z", true), s("b", "2026-11-01T23:01:00.000Z", false)],
      "2026-11-01",
      "2026-11-02T12:00:00.000Z",
    );
    expect(days).toEqual([
      { date: "2026-11-01", games: 1, wins: 1, losses: 0, partial: false },
      { date: "2026-11-02", games: 1, wins: 0, losses: 1, partial: true },
    ]);
  });
  it("compte un jour couvert sans partie comme un vrai zéro", () => {
    const days = dailySeries([], "2026-11-01", "2026-11-03T12:00:00.000Z");
    expect(days.map((d) => d.games)).toEqual([0, 0, 0]);
  });
  it("ne renvoie rien sans couverture : pas de données n'est pas zéro", () => {
    expect(dailySeries([s("a", "2026-11-01T10:00:00.000Z")], "2026-11-01", null)).toEqual([]);
  });
  it("ignore les sessions hors plage", () => {
    const days = dailySeries([s("a", "2026-10-01T10:00:00.000Z")], "2026-11-01", "2026-11-01T12:00:00.000Z");
    expect(days[0]?.games).toBe(0);
    expect(days).toHaveLength(1);
  });
});

describe("filterRange et bucketize", () => {
  const days = dailySeries(
    Array.from({ length: 15 }, (_, i) => s(`g${i}`, `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, i % 2 === 0)),
    "2026-10-01",
    "2026-10-15T12:00:00.000Z",
  );
  it("filtre sur les derniers jours", () => {
    expect(filterRange(days, "7")).toHaveLength(7);
    expect(filterRange(days, "7").at(-1)?.date).toBe("2026-10-15");
    expect(filterRange(days, "30")).toHaveLength(15);
    expect(filterRange(days, "all")).toHaveLength(15);
  });
  it("garde une ligne par jour avec une taille de 1", () => expect(bucketize(days, 1)).toHaveLength(15));
  it("regroupe par 7 jours depuis la fin sans perdre de partie", () => {
    const weeks = bucketize(days, 7);
    expect(weeks.map((w) => w.games)).toEqual([1, 7, 7]);
    expect(weeks.reduce((n, w) => n + w.wins + w.losses, 0)).toBe(15);
    expect(weeks.at(-1)).toMatchObject({ date: "2026-10-09", endDate: "2026-10-15", partial: true });
  });
  it("laisse un taux absent pour une période sans partie", () => {
    expect(bucketize(dailySeries([], "2026-11-01", "2026-11-01T10:00:00.000Z"), 1)[0]?.winRate).toBeNull();
  });
});

describe("groupStats", () => {
  /** `games` parties à `players` joueurs du clan, dont `wins` gagnées. */
  const games = (players: number, count: number, wins: number) =>
    Array.from({ length: count }, (_, i) => s(`p${players}-${i}`, "2026-11-01T10:00:00.000Z", i < wins, players));

  it("regroupe par taille et calcule le taux et la part jouée seul", () => {
    const stats = groupStats([...games(1, 4, 1), ...games(2, 2, 1), ...games(6, 1, 1), ...games(7, 1, 1), ...games(8, 2, 2)], 1)!;
    expect(stats.sizes.map((x) => [x.label, x.games, x.wins, x.winRate])).toEqual([
      ["Seul sous le tag", 4, 1, 25],
      ["2 joueurs du clan", 2, 1, 50],
      ["5 à 7 joueurs du clan", 2, 2, 100],
      ["8 joueurs du clan ou plus", 2, 2, 100],
    ]);
    expect(stats.games).toBe(10);
    expect(stats.soloShare).toBe(40);
  });
  it("écarte une taille sous le minimum de parties", () => {
    const stats = groupStats([...games(1, 5, 1), ...games(2, 5, 2), ...games(8, 4, 4)], 5)!;
    expect(stats.sizes.map((x) => x.label)).toEqual(["Seul sous le tag", "2 joueurs du clan"]);
  });
  it("garde une partie sous le minimum dans le total", () => {
    expect(groupStats([...games(1, 5, 1), ...games(2, 5, 2), ...games(8, 4, 4)], 5)?.games).toBe(14);
  });
  it("ignore une partie sans joueur du clan", () => {
    expect(groupStats([...games(0, 5, 5), ...games(1, 5, 1), ...games(2, 5, 2)], 5)?.games).toBe(10);
  });
  it("ne renvoie rien si le groupe ne gagne pas plus", () => {
    expect(groupStats([...games(1, 5, 3), ...games(2, 5, 3)], 5)).toBeNull();
    expect(groupStats([...games(1, 5, 3), ...games(2, 5, 1)], 5)).toBeNull();
  });
  it("ne renvoie rien avec une seule taille ou sans données", () => {
    expect(groupStats(games(1, 5, 1), 5)).toBeNull();
    expect(groupStats([])).toBeNull();
  });
});

describe("heatmap", () => {
  it("place les parties en heure de Paris, lundi en premier", () => {
    // Lundi 2 nov. 2026, 20 h UTC = 21 h à Paris.
    const map = buildHeatmap([s("a", "2026-11-02T20:00:00.000Z", true, 4)], "2026-11-03T00:00:00.000Z")!;
    expect(map.grid[0]?.[21]).toBe(1);
    expect(map.players[0]?.[21]).toBe(4);
    expect(map.total).toBe(1);
    expect(map.max).toBe(1);
  });
  it("limite la fenêtre à 90 jours", () => {
    const map = buildHeatmap([s("old", "2026-01-01T10:00:00.000Z"), s("new", "2026-11-01T10:00:00.000Z")], "2026-11-02T00:00:00.000Z")!;
    expect(map.total).toBe(1);
    expect(map.from).toBe("2026-08-05");
  });
  it("renvoie null sans couverture", () => expect(buildHeatmap([], null)).toBeNull());
});

describe("bestSlots", () => {
  const repeat = (n: number, prefix: string, iso: string, players: number) =>
    Array.from({ length: n }, (_, i) => s(`${prefix}${i}`, iso, true, players));
  const sessions = [
    ...repeat(8, "a", "2026-11-02T20:00:00.000Z", 2), // lundi 21 h
    ...repeat(8, "b", "2026-11-03T20:00:00.000Z", 5), // mardi 21 h
    ...repeat(4, "c", "2026-11-04T20:00:00.000Z", 9), // sous le minimum
  ];
  const map = buildHeatmap(sessions, "2026-11-05T00:00:00.000Z");

  it("classe par parties, puis par joueurs du clan en cas d'égalité", () => {
    expect(bestSlots(map).map((x) => [x.weekday, x.hour, x.games, x.avgPlayers])).toEqual([
      [1, 21, 8, 5],
      [0, 21, 8, 2],
    ]);
  });
  it("écarte les créneaux sous le minimum", () => expect(bestSlots(map, 5, 9)).toEqual([]));
  it("limite le nombre de créneaux", () => expect(bestSlots(map, 1)).toHaveLength(1));
  it("ne renvoie rien sans données", () => expect(bestSlots(null)).toEqual([]));
});
