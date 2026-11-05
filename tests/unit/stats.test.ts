import { describe, expect, it } from "vitest";
import { findClan, neighbours, searchClans, winRate, withOfficialRanks } from "../../src/lib/stats";
import { filterMembers, gamesOf, rateOf, sortMembers, toStoredMember } from "../../src/lib/members";
import { freshness } from "../../src/lib/freshness";
import { fmtInt, fmtPct, NO_DATA } from "../../src/lib/format";
import type { LeaderboardEntry, StoredMember } from "../../src/lib/schemas";

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

describe("winRate", () => {
  it("calcule un pourcentage", () => expect(winRate(42, 78)).toBeCloseTo(53.846, 2));
  it("distingue zéro victoire de zéro partie", () => {
    expect(winRate(0, 10)).toBe(0);
    expect(winRate(0, 0)).toBeNull();
  });
});

describe("classement", () => {
  // Volontairement dans un ordre non trié par score : le rang suit la liste de l'API.
  const clans = withOfficialRanks([entry("UN", 100), entry("GAL", 80), entry("ITA", 90)]);

  it("garde l'ordre de l'API sans recalcul", () => {
    expect(clans.map((c) => [c.clanTag, c.rank])).toEqual([["UN", 1], ["GAL", 2], ["ITA", 3]]);
  });
  it("trouve un clan sans tenir compte de la casse", () => expect(findClan(clans, "gal")?.rank).toBe(2));
  it("renvoie null pour un clan hors liste, pas un rang 0", () => expect(findClan(clans, "ZZZ")).toBeNull());
  it("calcule l'écart avec les voisins", () => {
    const n = neighbours(withOfficialRanks([entry("A", 100), entry("B", 80), entry("C", 50)]), "B");
    expect(n?.above?.gap).toBe(20);
    expect(n?.below?.gap).toBe(30);
  });
  it("n'a pas de voisin au-dessus du premier ni en dessous du dernier", () => {
    const list = withOfficialRanks([entry("A", 100), entry("B", 80)]);
    expect(neighbours(list, "A")?.above).toBeNull();
    expect(neighbours(list, "B")?.below).toBeNull();
    expect(neighbours(list, "Z")).toBeNull();
  });
  it("recherche sans changer les rangs", () => {
    expect(searchClans(clans, " it ").map((c) => c.rank)).toEqual([3]);
    expect(searchClans(clans, "")).toHaveLength(3);
  });
});

describe("membres", () => {
  const m = (username: string | null, team: StoredMember["team"], joinedAt: string): StoredMember => ({
    role: "member",
    joinedAt,
    publicId: username ? `id-${username}` : null,
    username,
    team,
  });
  const a = m("Alpha", { wins: 10, losses: 10 }, "2026-05-01T00:00:00.000Z");
  const b = m("Bravo", { wins: 3, losses: 0 }, "2026-06-01T00:00:00.000Z");
  const zero = m(null, { wins: 0, losses: 0 }, "2026-07-01T00:00:00.000Z");
  const none = m("SansStats", null, "2026-04-01T00:00:00.000Z");
  const all = [a, b, zero, none];
  const names = (l: StoredMember[]) => l.map((x) => x.username);

  it("trie par victoires, parties, taux et arrivée", () => {
    expect(names(sortMembers(all, "wins", "desc"))).toEqual(["Alpha", "Bravo", null, "SansStats"]);
    expect(names(sortMembers(all, "games", "desc"))).toEqual(["Alpha", "Bravo", null, "SansStats"]);
    expect(names(sortMembers(all, "rate", "desc"))[0]).toBe("Bravo");
    expect(names(sortMembers(all, "joinedAt", "asc"))).toEqual(["SansStats", "Alpha", "Bravo", null]);
  });
  it("laisse les valeurs absentes en fin de liste, dans les deux sens", () => {
    expect(sortMembers(all, "wins", "asc").at(-1)?.username).toBe("SansStats");
    expect(sortMembers(all, "rate", "asc").slice(-2).map((x) => x.team?.wins ?? null)).toEqual([0, null]);
    expect(sortMembers(all, "rate", "desc").slice(-2).map((x) => x.team?.wins ?? null)).toEqual([0, null]);
  });
  it("distingue zéro partie de pas de données", () => {
    expect(gamesOf(zero)).toBe(0);
    expect(rateOf(zero)).toBeNull();
    expect(gamesOf(none)).toBeNull();
  });
  it("recherche par pseudo, sans la casse", () => {
    expect(names(filterMembers(all, "ALP"))).toEqual(["Alpha"]);
    expect(filterMembers(all, "  ")).toHaveLength(4);
    expect(filterMembers(all, "inconnu")).toHaveLength(0);
  });
  it("n'écrit jamais le publicId d'un membre sans pseudo", () => {
    const anon = toStoredMember({ role: "member", joinedAt: a.joinedAt, publicId: "SECRET", username: null, stats: { team: { wins: 1, losses: 2 } } });
    expect(anon.publicId).toBeNull();
    expect(JSON.stringify(anon)).not.toContain("SECRET");
  });
  it("garde le publicId d'un membre avec pseudo et note l'absence de stats", () => {
    const named = toStoredMember({ role: "officer", joinedAt: a.joinedAt, publicId: "abc", username: "Nom" });
    expect(named.publicId).toBe("abc");
    expect(named.team).toBeNull();
  });
});

describe("freshness", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("signale l'absence de données", () => expect(freshness(null, 4, now)).toBe("missing"));
  it("accepte une donnée récente", () => expect(freshness("2026-11-05T09:00:00Z", 4, now)).toBe("fresh"));
  it("signale une donnée périmée", () => expect(freshness("2026-11-05T07:59:00Z", 4, now)).toBe("stale"));
});

describe("format", () => {
  it("affiche un tiret pour l'absence, et 0 pour zéro", () => {
    expect(fmtInt(null)).toBe(NO_DATA);
    expect(fmtPct(null)).toBe(NO_DATA);
    expect(fmtInt(0)).toBe("0");
  });
});
