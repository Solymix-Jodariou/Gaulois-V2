import type { LeaderboardEntry, RivalsSnapshot } from "./schemas";

export interface RivalPoint {
  date: string;
  /** Score du clan moins celui du rival : positif, le clan est devant. `null` : l'un des deux est hors de la liste ce jour-là. */
  value: number | null;
}

export interface RivalSeries {
  clanTag: string;
  /** Rang du rival dans le dernier classement, position dans la liste de l'API. */
  rank: number;
  points: RivalPoint[];
}

const score = (snap: RivalsSnapshot, tag: string) => snap.clans.find((c) => c.clanTag.toUpperCase() === tag)?.weightedWins ?? null;

/**
 * Écart de score, jour après jour, avec les voisins du clan dans le dernier classement.
 * `null` si le clan est hors de la liste : il n'a alors pas de voisins.
 */
export function rivalSeries(
  clans: readonly LeaderboardEntry[],
  snapshots: readonly RivalsSnapshot[],
  tag: string,
  above = 1,
  below = 2,
): RivalSeries[] | null {
  const me = tag.toUpperCase();
  const index = clans.findIndex((c) => c.clanTag.toUpperCase() === me);
  if (index < 0) return null;
  const neighbours = clans.flatMap((c, i) => (i !== index && i >= index - above && i <= index + below ? [{ clan: c, rank: i + 1 }] : []));
  return neighbours.map(({ clan, rank }) => ({
    clanTag: clan.clanTag,
    rank,
    points: snapshots.map((snap) => {
      const mine = score(snap, me);
      const theirs = score(snap, clan.clanTag.toUpperCase());
      return { date: snap.date, value: mine === null || theirs === null ? null : mine - theirs };
    }),
  }));
}
