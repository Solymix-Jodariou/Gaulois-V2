import { describe, expect, it } from "vitest";
import { clanRecords, formatResults } from "../../src/lib/results";
import type { StoredSession } from "../../src/lib/schemas";

const covered = "2026-11-07T10:00:00.000Z";

function game(over: Partial<StoredSession> & { gameId: string }): StoredSession {
  return {
    clanPlayerCount: 2,
    hasWon: true,
    numTeams: 2,
    playerTeams: "2",
    totalPlayerCount: 20,
    gameStart: "2026-11-01T10:00:00.000Z",
    score: 1,
    ...over,
  };
}
const many = (prefix: string, count: number, wins: number, over: Partial<StoredSession> = {}) =>
  Array.from({ length: count }, (_, i) => game({ gameId: `${prefix}${i}`, hasWon: i < wins, ...over }));

describe("formatResults", () => {
  it("calcule le taux et le repère de hasard par format", () => {
    const out = formatResults([...many("a", 4, 1, { playerTeams: "4", numTeams: 4 })], covered, 1);
    expect(out?.byTeams[0]).toMatchObject({ key: "4", label: "4 équipes", games: 4, wins: 1, winRate: 25, chance: 25 });
  });
  it("moyenne le hasard quand le nombre d'équipes varie dans un format", () => {
    const out = formatResults([game({ gameId: "a", playerTeams: "Duos", numTeams: 10 }), game({ gameId: "b", playerTeams: "Duos", numTeams: 20 })], covered, 1);
    expect(out?.bySize[0]?.chance).toBeCloseTo(7.5);
  });
  it("laisse le hasard vide si le nombre d'équipes manque, sans inventer de zéro", () => {
    const out = formatResults([game({ gameId: "a", numTeams: 0 })], covered, 1);
    expect(out?.byTeams[0]?.chance).toBeNull();
  });
  it("sépare et ordonne les formats par équipes et par taille", () => {
    const rows = [
      ...many("a", 1, 1, { playerTeams: "Quads" }),
      ...many("b", 1, 1, { playerTeams: "Duos" }),
      ...many("c", 1, 1, { playerTeams: "7" }),
      ...many("d", 1, 1, { playerTeams: "2" }),
    ];
    const out = formatResults(rows, covered, 1);
    expect(out?.byTeams.map((r) => r.key)).toEqual(["2", "7"]);
    expect(out?.bySize.map((r) => r.key)).toEqual(["Duos", "Quads"]);
  });
  it("limite le taux à 90 jours et donne le total à part", () => {
    const old = many("old", 10, 0, { gameStart: "2026-01-01T10:00:00.000Z" });
    const recent = many("new", 10, 10);
    const row = formatResults([...old, ...recent], covered, 1)?.byTeams[0];
    expect(row).toMatchObject({ games: 10, winRate: 100, allTime: { games: 20, winRate: 50 } });
  });
  it("garde le jour de la limite et écarte la veille", () => {
    const out = formatResults([game({ gameId: "in", gameStart: "2026-08-10T10:00:00.000Z" }), game({ gameId: "out", gameStart: "2026-08-09T10:00:00.000Z" })], covered, 1);
    expect(out).toMatchObject({ from: "2026-08-10", to: "2026-11-07" });
    expect(out?.byTeams[0]?.games).toBe(1);
  });
  it("écarte un format sous le minimum de parties et les parties sans format", () => {
    const out = formatResults([...many("a", 2, 1, { playerTeams: "3" }), ...many("b", 3, 1), ...many("c", 5, 1, { playerTeams: null })], covered, 3);
    expect(out?.byTeams.map((r) => r.key)).toEqual(["2"]);
  });
  it("ne renvoie rien sans couverture ni données : pas de données n'est pas zéro", () => {
    expect(formatResults(many("a", 5, 5), null)).toBeNull();
    expect(formatResults([], covered)).toBeNull();
  });
});

describe("clanRecords", () => {
  const at = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

  it("trouve la plus longue série, en ordre de début de partie", () => {
    const rows = [
      game({ gameId: "d", gameStart: at(4), hasWon: true }),
      game({ gameId: "a", gameStart: at(1), hasWon: true }),
      game({ gameId: "b", gameStart: at(2), hasWon: false }),
      game({ gameId: "c", gameStart: at(3), hasWon: true }),
    ];
    expect(clanRecords(rows)?.streak).toEqual({ wins: 2, endedAt: at(4) });
  });
  it("trouve la journée de Paris la plus riche en victoires, la plus ancienne à égalité", () => {
    const rows = [
      game({ gameId: "a", gameStart: at(1) }),
      game({ gameId: "b", gameStart: at(2), hasWon: false }),
      game({ gameId: "c", gameStart: at(2) }),
      game({ gameId: "d", gameStart: at(3) }),
    ];
    expect(clanRecords(rows)?.bestDay).toEqual({ date: "2026-10-01", wins: 1, games: 1 });
    // 23 h 30 UTC : déjà le lendemain à Paris.
    const late = [game({ gameId: "e", gameStart: "2026-10-30T23:30:00.000Z" }), game({ gameId: "f", gameStart: "2026-10-31T10:00:00.000Z" })];
    expect(clanRecords(late)?.bestDay).toEqual({ date: "2026-10-31", wins: 2, games: 2 });
  });
  it("ne compte que les victoires pour le plus grand groupe et le plus d'équipes", () => {
    const rows = [
      game({ gameId: "a", gameStart: at(1), clanPlayerCount: 3, numTeams: 5, totalPlayerCount: 30 }),
      game({ gameId: "b", gameStart: at(2), clanPlayerCount: 9, numTeams: 40, totalPlayerCount: 99, hasWon: false }),
      game({ gameId: "c", gameStart: at(3), clanPlayerCount: 2, numTeams: 8, totalPlayerCount: 16 }),
    ];
    const out = clanRecords(rows);
    expect(out?.biggestGroup).toEqual({ players: 3, at: at(1) });
    expect(out?.mostTeams).toEqual({ teams: 8, players: 16, at: at(3) });
  });
  it("écarte une partie seule dans le salon, gagnée d'avance", () => {
    const rows = [game({ gameId: "solo", gameStart: at(1), totalPlayerCount: 1, numTeams: 60 }), game({ gameId: "a", gameStart: at(2), numTeams: 4 })];
    const out = clanRecords(rows);
    expect(out?.mostTeams.teams).toBe(4);
    expect(out?.streak.wins).toBe(1);
  });
  it("ne modifie pas la liste reçue", () => {
    const rows = [game({ gameId: "b", gameStart: at(2) }), game({ gameId: "a", gameStart: at(1) })];
    clanRecords(rows);
    expect(rows.map((r) => r.gameId)).toEqual(["b", "a"]);
  });
  it("ne renvoie rien sans victoire", () => {
    expect(clanRecords([])).toBeNull();
    expect(clanRecords(many("a", 3, 0))).toBeNull();
    expect(clanRecords([game({ gameId: "solo", totalPlayerCount: 1 })])).toBeNull();
  });
});
