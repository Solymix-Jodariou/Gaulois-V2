import { describe, expect, it } from "vitest";
import { MEMBER_RECENT_GAMES, memberGamesUnderTag, recentGamesTitle } from "../../src/lib/members";
import { ApiDeletedPlayers, ApiPlayerGames, type ApiPlayerGame, type StoredMemberRecent } from "../../src/lib/schemas";

function row(over: Partial<ApiPlayerGame> = {}): ApiPlayerGame {
  return { start: "2026-11-03T20:00:00.000Z", map: "World", mode: "Team", type: "Public", rankedType: "unranked", playerTeams: "Duos", result: "victory", clanTag: "GAL", ...over };
}
function recent(over: Partial<StoredMemberRecent> = {}): StoredMemberRecent {
  return { seen: 10, readOn: "2026-11-07", recent: [], ...over };
}
const game = { date: "2026-11-03", map: "World", teams: "Duos", result: "victory" as const };

describe("memberGamesUnderTag", () => {
  it("ne garde que les lignes de stats.team : le tag du clan, en équipe, en public, hors classé, gagnées ou perdues", () => {
    const rows = [row({ map: "Gardée" }), row({ map: "Sans précision", rankedType: null }), row({ clanTag: "UN" }), row({ clanTag: null }), row({ clanTag: undefined }), row({ mode: "Free For All" }), row({ type: "Private" }), row({ rankedType: "ranked" }), row({ result: "incomplete" })];
    expect(memberGamesUnderTag(rows, "GAL").map((g) => g.map)).toEqual(["Gardée", "Sans précision"]);
  });
  it("garde les plus récentes, dans l'ordre de l'API, jusqu'à la limite", () => {
    const rows = Array.from({ length: MEMBER_RECENT_GAMES + 3 }, (_, i) => row({ map: `C${i}` }));
    const out = memberGamesUnderTag(rows, "GAL");
    expect(out).toHaveLength(MEMBER_RECENT_GAMES);
    expect(out[0]?.map).toBe("C0");
  });
  it("garde le jour à l'heure de Paris, jamais l'heure de la partie", () => {
    const [out] = memberGamesUnderTag([row({ start: "2026-11-03T23:30:00.000Z" })], "GAL");
    expect(out).toEqual({ date: "2026-11-04", map: "World", teams: "Duos", result: "victory" });
    expect(JSON.stringify(out)).not.toContain("23:30");
  });
  it("garde un format absent comme absent", () => {
    expect(memberGamesUnderTag([row({ playerTeams: null })], "GAL")[0]?.teams).toBeNull();
  });
});

describe("le schéma des parties d'un joueur", () => {
  const line = { gameId: "g", start: "2026-11-03T20:00:00.000Z", durationSeconds: 100, map: "World", mode: "Team", type: "Public", playerTeams: 4, rankedType: "unranked", result: "defeat", totalPlayers: 8, username: "NomSecret", clanTag: "GAL" };

  it("accepte une réponse réelle et ne garde ni pseudo ni identifiant de partie", () => {
    const [out] = ApiPlayerGames.parse({ results: [line], nextCursor: null }).results;
    expect(out).toEqual({ start: line.start, map: "World", mode: "Team", type: "Public", rankedType: "unranked", playerTeams: "4", result: "defeat", clanTag: "GAL" });
    expect(JSON.stringify(out)).not.toContain("NomSecret");
  });
  it("accepte un format et un tag absents, et refuse un résultat inconnu", () => {
    expect(ApiPlayerGames.safeParse({ results: [{ ...line, playerTeams: null, clanTag: null }], nextCursor: "x" }).success).toBe(true);
    expect(ApiPlayerGames.safeParse({ results: [{ ...line, result: "abandon" }], nextCursor: null }).success).toBe(false);
  });
  it("lit la liste des comptes supprimés", () => {
    expect(ApiDeletedPlayers.parse([{ publicId: "abc", deletedAt: "2026-11-07T00:00:00.000Z" }])).toEqual([{ publicId: "abc" }]);
    expect(ApiDeletedPlayers.safeParse([{ deletedAt: "2026-11-07T00:00:00.000Z" }]).success).toBe(false);
  });
});

describe("recentGamesTitle", () => {
  it("dit ce qui a été lu", () => {
    const many = Array.from({ length: MEMBER_RECENT_GAMES }, () => game);
    expect(recentGamesTitle(recent({ recent: many }), 1357)).toBe("Ses 10 dernières parties sous le tag.");
    expect(recentGamesTitle(recent({ recent: [game, game, game] }), 3)).toBe("Ses 3 parties sous le tag.");
    expect(recentGamesTitle(recent({ recent: [game] }), 1)).toBe("Sa seule partie sous le tag.");
    expect(recentGamesTitle(recent({ recent: [game, game] }), 56)).toBe("Ses 2 dernières parties sous le tag.");
    expect(recentGamesTitle(recent({ recent: [game] }), 56)).toBe("Sa dernière partie sous le tag.");
  });
  it("reste juste quand la liste est plus récente que les stats", () => {
    expect(recentGamesTitle(recent({ recent: [game, game, game] }), 2)).toBe("Ses 3 dernières parties sous le tag.");
  });
  it("n'a rien à dire sans partie trouvée : expliquer pourquoi dirait ce que le joueur fait hors du tag", () => {
    expect(recentGamesTitle(recent(), 56)).toBeNull();
  });
});
