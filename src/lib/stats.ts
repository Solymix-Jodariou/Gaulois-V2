import type { LeaderboardEntry } from "./schemas";

/** Taux de victoire en %. `null` si aucune partie : 0 partie n'est pas un taux de 0 %. */
export function winRate(wins: number, games: number): number | null {
  return games > 0 ? (wins / games) * 100 : null;
}

export interface RankedClan extends LeaderboardEntry {
  /** Position dans la liste renvoyée par l'API. Aucun tri n'est refait ici. */
  rank: number;
}

export function withOfficialRanks(clans: readonly LeaderboardEntry[]): RankedClan[] {
  return clans.map((c, i) => ({ ...c, rank: i + 1 }));
}

export function findClan(clans: readonly RankedClan[], tag: string): RankedClan | null {
  const t = tag.toUpperCase();
  return clans.find((c) => c.clanTag.toUpperCase() === t) ?? null;
}

export interface Neighbours {
  above: { clan: RankedClan; gap: number } | null;
  below: { clan: RankedClan; gap: number } | null;
}

/** Écart de score (victoires pondérées) avec les clans juste au-dessus et en dessous. */
export function neighbours(clans: readonly RankedClan[], tag: string): Neighbours | null {
  const me = findClan(clans, tag);
  if (!me) return null;
  const above = clans[me.rank - 2];
  const below = clans[me.rank];
  return {
    above: above ? { clan: above, gap: above.weightedWins - me.weightedWins } : null,
    below: below ? { clan: below, gap: me.weightedWins - below.weightedWins } : null,
  };
}

export function searchClans<T extends { clanTag: string }>(clans: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? clans.filter((c) => c.clanTag.toLowerCase().includes(q)) : [...clans];
}
