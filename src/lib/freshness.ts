/** Âge maximal avant qu'un jeu de données soit signalé comme périmé, en heures. */
export const MAX_AGE_HOURS = { leaderboard: 4, sessions: 4, members: 36, clanmap: 36 } as const;

export type Freshness = "missing" | "fresh" | "stale";

export function freshness(lastSuccessAt: string | null, maxAgeHours: number, now: Date): Freshness {
  if (!lastSuccessAt) return "missing";
  return now.getTime() - Date.parse(lastSuccessAt) > maxAgeHours * 3_600_000 ? "stale" : "fresh";
}
