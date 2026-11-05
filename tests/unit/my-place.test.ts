import { describe, expect, it } from "vitest";
import { placeOf, suggestMembers } from "../../src/lib/members";
import type { StoredMember } from "../../src/lib/schemas";

const member = (username: string | null, wins: number | null, losses = 0): StoredMember => ({
  role: "member",
  joinedAt: "2026-05-03T20:17:40.935Z",
  publicId: username,
  username,
  team: wins === null ? null : { wins, losses },
});
const members = [member("Alpha", 100), member("Bravo", 80), member("Charlie", 80), member(null, 50), member("Delta", 10), member("Echo", 0), member("Sans", null)];

describe("Ma place", () => {
  it("donne la place, le joueur à dépasser et celui qui suit", () => {
    const place = placeOf(members, members[4]!);
    expect(place).toMatchObject({ rank: 5, ranked: 6, wins: 10, missing: 41, lead: 10 });
    expect(place?.next?.username).toBeNull();
    expect(place?.behind?.username).toBe("Echo");
  });

  it("met deux membres à égalité à la même place, et vise le suivant au-dessus", () => {
    const bravo = placeOf(members, members[1]!);
    const charlie = placeOf(members, members[2]!);
    expect(bravo?.rank).toBe(2);
    expect(charlie?.rank).toBe(2);
    expect(bravo?.next?.username).toBe("Alpha");
    expect(bravo?.missing).toBe(21);
  });

  it("n'a personne devant le premier ni derrière le dernier", () => {
    expect(placeOf(members, members[0]!)).toMatchObject({ rank: 1, next: null, missing: null });
    expect(placeOf(members, members[5]!)).toMatchObject({ rank: 6, behind: null, lead: null });
  });

  it("ne classe pas un membre sans stats, et ne le compte pas", () => {
    expect(placeOf(members, members[6]!)).toBeNull();
    expect(placeOf(members, members[0]!)?.ranked).toBe(6);
  });

  it("propose d'abord le pseudo exact, puis ceux qui commencent pareil", () => {
    const list = [member("Bobby", 1), member("Bob", 1), member("Jimbob", 1), member("Bobette", 1)];
    expect(suggestMembers(list, "bob").map((m) => m.username)).toEqual(["Bob", "Bobby", "Bobette", "Jimbob"]);
  });

  it("ne retrouve jamais un membre anonyme et ne propose rien sans recherche", () => {
    expect(suggestMembers(members, "anonyme")).toEqual([]);
    expect(suggestMembers(members, "  ")).toEqual([]);
    expect(suggestMembers(members, "a", 2)).toHaveLength(2);
  });
});
