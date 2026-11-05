import type { StoredMember } from "./schemas";
import { winRate } from "./stats";

/** Conversion API → fichier public. Le `publicId` d'un membre sans pseudo n'est jamais écrit. */
export function toStoredMember(m: {
  role: StoredMember["role"];
  joinedAt: string;
  publicId: string;
  username?: string | null | undefined;
  stats?: { team: { wins: number; losses: number } } | undefined;
}): StoredMember {
  const username = m.username ?? null;
  return {
    role: m.role,
    joinedAt: m.joinedAt,
    publicId: username ? m.publicId : null,
    username,
    team: m.stats ? { wins: m.stats.team.wins, losses: m.stats.team.losses } : null,
  };
}

export const gamesOf = (m: StoredMember): number | null => (m.team ? m.team.wins + m.team.losses : null);
export const rateOf = (m: StoredMember): number | null =>
  m.team ? winRate(m.team.wins, m.team.wins + m.team.losses) : null;

export type SortKey = "wins" | "games" | "rate" | "joinedAt";
export type SortDir = "asc" | "desc";

function valueOf(m: StoredMember, key: SortKey): number | null {
  switch (key) {
    case "wins":
      return m.team ? m.team.wins : null;
    case "games":
      return gamesOf(m);
    case "rate":
      return rateOf(m);
    case "joinedAt":
      return Date.parse(m.joinedAt);
  }
}

/** Tri stable. Les valeurs absentes (pas de stats, taux sans partie) restent toujours en fin de liste. */
export function sortMembers(members: readonly StoredMember[], key: SortKey, dir: SortDir): StoredMember[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...members].sort((a, b) => {
    const va = valueOf(a, key);
    const vb = valueOf(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * sign;
  });
}

/** Recherche par pseudo. Les membres anonymes n'ont pas de pseudo et ne ressortent pas d'une recherche. */
export function filterMembers(members: readonly StoredMember[], query: string): StoredMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...members];
  return members.filter((m) => m.username?.toLowerCase().includes(q));
}
