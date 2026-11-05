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

/** Les pseudos qui correspondent : d'abord le pseudo exact, puis ceux qui commencent ainsi, puis les autres. */
export function suggestMembers(members: readonly StoredMember[], query: string, limit = 5): StoredMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (m: StoredMember) => {
    const name = m.username?.toLowerCase() ?? "";
    if (name === q) return 0;
    return name.startsWith(q) ? 1 : 2;
  };
  return filterMembers(members, q)
    .sort((a, b) => score(a) - score(b) || (a.username ?? "").localeCompare(b.username ?? "", "fr"))
    .slice(0, limit);
}

export interface MemberPlace {
  member: StoredMember;
  wins: number;
  /** Place au nombre de victoires sous le tag. Deux membres à égalité partagent la même place. */
  rank: number;
  /** Membres dont les stats sont connues : ce sont eux que la place départage. */
  ranked: number;
  /** Le joueur juste devant, et les victoires à gagner pour le dépasser. `null` : personne devant. */
  next: StoredMember | null;
  missing: number | null;
  /** Le joueur juste derrière, et l'avance sur lui. `null` : personne derrière. */
  behind: StoredMember | null;
  lead: number | null;
}

/**
 * La place d'un membre dans le tri de la page Membres, par victoires en équipe sous le tag.
 * `null` si l'API n'a pas donné ses stats : pas de données, ce n'est pas une dernière place.
 */
export function placeOf(members: readonly StoredMember[], member: StoredMember): MemberPlace | null {
  if (!member.team) return null;
  const wins = member.team.wins;
  const known = members.filter((m) => m.team);
  let next: StoredMember | null = null;
  let behind: StoredMember | null = null;
  let ahead = 0;
  for (const m of known) {
    const w = m.team?.wins ?? 0;
    if (w > wins) {
      ahead++;
      if (!next || w < (next.team?.wins ?? 0)) next = m;
    } else if (w < wins && (!behind || w > (behind.team?.wins ?? 0))) {
      behind = m;
    }
  }
  return {
    member,
    wins,
    rank: ahead + 1,
    ranked: known.length,
    next,
    missing: next ? (next.team?.wins ?? 0) - wins + 1 : null,
    behind,
    lead: behind ? wins - (behind.team?.wins ?? 0) : null,
  };
}
