import { describe, expect, it } from "vitest";
import {
  Announcements,
  ApiLeaderboard,
  ApiMembersPage,
  ApiSessionsPage,
  HistorySnapshot,
  Links,
  Meta,
  emptyMeta,
} from "../../src/lib/schemas";

// Extraits de réponses réelles du 5 novembre 2026 (voir docs/API_AUDIT.md).
const leaderboard = {
  start: "2026-08-07T09:26:45.415Z",
  end: "2026-11-05T09:26:45.415Z",
  clans: [
    { clanTag: "GAL", games: 5898, wins: 2464, losses: 3434, playerSessions: 15420, weightedWins: 2079.31, weightedLosses: 310.85, weightedWLRatio: 6.69, elo: 1470 },
    { clanTag: "NU", games: 13154, wins: 4588, losses: 8566, playerSessions: 26867, weightedWins: 1310.19, weightedLosses: 376.72, weightedWLRatio: 3.48, elo: null },
  ],
};
const sessions = {
  results: [
    { gameId: "dX3XnVEzub", clanTag: "GAL", clanPlayerCount: 3, hasWon: false, numTeams: 16, playerTeams: "Trios", totalPlayerCount: 47, gameStart: "2026-11-04T23:57:16.183Z", score: -0.26 },
  ],
  total: 78,
  page: 1,
  limit: 50,
};
const wl = { wins: 69, losses: 43 };
const members = {
  results: [
    { role: "officer", joinedAt: "2026-05-03T20:17:40.935Z", publicId: "x", username: null, stats: { team: wl, total: wl, ranked: wl }, eloContributed: null, level: 24, prestige: 1, legend: false },
    { role: "member", joinedAt: "2026-05-03T20:17:40.935Z", publicId: "y" },
  ],
  total: 2,
  page: 1,
  limit: 50,
};

describe("schémas de l'API", () => {
  it("accepte les réponses réelles", () => {
    expect(ApiLeaderboard.safeParse(leaderboard).success).toBe(true);
    expect(ApiSessionsPage.safeParse(sessions).success).toBe(true);
    expect(ApiMembersPage.safeParse(members).success).toBe(true);
  });
  it("retire l'elo : la note classée n'entre jamais dans les stats de clan", () => {
    expect(ApiLeaderboard.parse(leaderboard).clans[0]).not.toHaveProperty("elo");
  });
  it("ne garde des membres que les stats d'équipe", () => {
    const stats = ApiMembersPage.parse(members).results[0]?.stats;
    expect(Object.keys(stats ?? {})).toEqual(["team"]);
  });
  it("accepte un membre sans stats ni pseudo", () => {
    const m = ApiMembersPage.parse(members).results[1];
    expect(m?.stats).toBeUndefined();
    expect(m?.username).toBeUndefined();
  });
  it("normalise playerTeams en texte", () => {
    const page = { ...sessions, results: [{ ...sessions.results[0], playerTeams: 2 }] };
    expect(ApiSessionsPage.parse(page).results[0]?.playerTeams).toBe("2");
  });
  it.each([
    ["liste vide", { ...leaderboard, clans: [] }],
    ["score en texte", { ...leaderboard, clans: [{ ...leaderboard.clans[0], weightedWins: "2079" }] }],
    ["date invalide", { ...leaderboard, end: "hier" }],
    ["champ manquant", { start: leaderboard.start, end: leaderboard.end }],
  ])("refuse un classement invalide : %s", (_label, value) => {
    expect(ApiLeaderboard.safeParse(value).success).toBe(false);
  });
  it("refuse un rôle inconnu", () => {
    const bad = { ...members, results: [{ ...members.results[1], role: "roi" }] };
    expect(ApiMembersPage.safeParse(bad).success).toBe(false);
  });
});

describe("fichiers du site", () => {
  it("accepte l'état initial de meta", () => expect(Meta.safeParse(emptyMeta()).success).toBe(true));
  it("refuse un rang 0 dans un instantané, et accepte l'absence de rang", () => {
    const snap = { date: "2026-11-05", capturedAt: "2026-11-05T10:00:00.000Z", leaderboardEnd: "2026-11-05T09:00:00.000Z", clansListed: 102, score: null, games: null, wins: null, losses: null, membersTotal: null };
    expect(HistorySnapshot.safeParse({ ...snap, rank: 0 }).success).toBe(false);
    expect(HistorySnapshot.safeParse({ ...snap, rank: null }).success).toBe(true);
  });
  it("valide les contenus éditables", () => {
    expect(Announcements.safeParse([{ date: "2026-11-05", title: "T", body: "B" }]).success).toBe(true);
    expect(Announcements.safeParse([{ date: "demain", title: "T", body: "B" }]).success).toBe(false);
    expect(Links.safeParse({ tools: [{ name: "X", url: "pas une url", description: "D" }] }).success).toBe(false);
  });
});
