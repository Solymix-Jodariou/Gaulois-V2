import { describe, expect, it } from "vitest";
import { rankedCounts } from "../../src/lib/ranked";
import type { ApiRankedPage, StoredMember } from "../../src/lib/schemas";

const entry = (public_id: string, rank: number) => ({ rank, public_id });
const page = (e1v1: ReturnType<typeof entry>[], e2v2: ReturnType<typeof entry>[] = [], ffa: ReturnType<typeof entry>[] = []): ApiRankedPage => ({
  "1v1": e1v1,
  "2v2": e2v2,
  ffa,
});
const member = (publicId: string | null, username: string | null): StoredMember => ({
  role: "member",
  joinedAt: "2026-05-03T20:17:40.935Z",
  publicId,
  username,
  team: { wins: 1, losses: 1 },
});
const at = "2026-11-07T10:00:00.000Z";

describe("rankedCounts", () => {
  it("compte les membres avec pseudo, et ceux des 10 premières places", () => {
    const out = rankedCounts([page([entry("a", 10), entry("x", 2), entry("b", 11)])], [member("a", "Alpha"), member("b", "Bravo")], at);
    expect(out.modes["1v1"]).toEqual({ listed: 3, members: 2, top: 1 });
    expect(out.fetchedAt).toBe(at);
  });
  it("n'écrit aucun joueur, membre ou non", () => {
    const out = JSON.stringify(rankedCounts([page([entry("id-a", 1), entry("AUTRE", 2)])], [member("id-a", "Alpha")], at));
    for (const absent of ["id-a", "AUTRE", "Alpha"]) expect(out).not.toContain(absent);
  });
  it("ne reconnaît pas un membre anonyme : le roster n'a pas son identifiant", () => {
    expect(rankedCounts([page([entry("SECRET", 1)])], [member(null, null)], at).modes["1v1"]).toEqual({ listed: 1, members: 0, top: 0 });
  });
  it("garde zéro membre distinct de zéro place lue", () => {
    const out = rankedCounts([page([entry("x", 1), entry("y", 2)])], [], at);
    expect(out.modes["1v1"]).toEqual({ listed: 2, members: 0, top: 0 });
    expect(out.modes.ffa).toEqual({ listed: 0, members: 0, top: 0 });
  });
  it("assemble les pages, mode par mode", () => {
    const members = [member("a", "Alpha"), member("b", "Bravo")];
    const out = rankedCounts([page([entry("b", 3)], [entry("a", 7)]), page([entry("a", 51)])], members, at);
    expect(out.modes["1v1"]).toEqual({ listed: 2, members: 2, top: 1 });
    expect(out.modes["2v2"]).toEqual({ listed: 1, members: 1, top: 1 });
  });
  it("ne compte qu'une fois un joueur vu sur deux pages, à sa meilleure place", () => {
    const out = rankedCounts([page([entry("a", 10)]), page([entry("a", 51)])], [member("a", "Alpha")], at);
    expect(out.modes["1v1"]).toEqual({ listed: 1, members: 1, top: 1 });
  });
});
