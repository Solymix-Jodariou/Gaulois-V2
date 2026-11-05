import type { StoredSession } from "./schemas";
import { addDays, dayRange, parisParts } from "./time";
import { winRate } from "./stats";

/** Fusionne des sessions sans doublon de `gameId` (la dernière lecture gagne), triées par heure. */
export function mergeSessions(existing: readonly StoredSession[], incoming: readonly StoredSession[]): StoredSession[] {
  const byId = new Map<string, StoredSession>();
  for (const s of existing) byId.set(s.gameId, s);
  for (const s of incoming) byId.set(s.gameId, s);
  return [...byId.values()].sort(
    (a, b) => a.gameStart.localeCompare(b.gameStart) || a.gameId.localeCompare(b.gameId),
  );
}

export interface DayStat {
  date: string;
  games: number;
  wins: number;
  losses: number;
  /** Journée pas encore terminée au moment de la collecte. */
  partial: boolean;
}

/**
 * Parties par jour de Paris, de `from` au jour de `coveredUntil`.
 * Un jour de la plage sans partie est un vrai zéro. Hors plage, il n'y a pas de ligne.
 */
export function dailySeries(sessions: readonly StoredSession[], from: string, coveredUntil: string | null): DayStat[] {
  if (!coveredUntil) return [];
  const last = parisParts(coveredUntil).date;
  const rows = new Map<string, DayStat>(
    dayRange(from, last).map((date) => [date, { date, games: 0, wins: 0, losses: 0, partial: date === last }]),
  );
  for (const s of sessions) {
    const row = rows.get(parisParts(s.gameStart).date);
    if (!row) continue;
    row.games++;
    if (s.hasWon) row.wins++;
    else row.losses++;
  }
  return [...rows.values()];
}

export type RangeKey = "7" | "30" | "all";

export function filterRange<T>(days: readonly T[], range: RangeKey): T[] {
  if (range === "all") return [...days];
  return days.slice(-Number(range));
}

export interface Bucket extends DayStat {
  /** Dernier jour du regroupement (égal à `date` pour un seul jour). */
  endDate: string;
  winRate: number | null;
}

/** Regroupe par blocs de 7 jours en partant de la fin, pour garder des barres lisibles. */
export function bucketize(days: readonly DayStat[], size: 1 | 7): Bucket[] {
  const out: Bucket[] = [];
  for (let end = days.length; end > 0; end -= size) {
    const chunk = days.slice(Math.max(0, end - size), end);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) continue;
    const games = chunk.reduce((n, d) => n + d.games, 0);
    const wins = chunk.reduce((n, d) => n + d.wins, 0);
    const losses = chunk.reduce((n, d) => n + d.losses, 0);
    out.unshift({
      date: first.date,
      endDate: last.date,
      games,
      wins,
      losses,
      partial: chunk.some((d) => d.partial),
      winRate: winRate(wins, games),
    });
  }
  return out;
}

const GROUP_SIZES = [
  { label: "Seul sous le tag", min: 1, max: 1 },
  { label: "2 joueurs du clan", min: 2, max: 2 },
  { label: "3 joueurs du clan", min: 3, max: 3 },
  { label: "4 joueurs du clan", min: 4, max: 4 },
  { label: "5 à 7 joueurs du clan", min: 5, max: 7 },
  { label: "8 joueurs du clan ou plus", min: 8, max: Infinity },
] as const;

export interface GroupSizeStat {
  label: string;
  games: number;
  wins: number;
  winRate: number;
}

export interface GroupStats {
  sizes: GroupSizeStat[];
  /** Parties avec au moins un joueur du clan. */
  games: number;
  /** Part des parties jouées seul sous le tag, en %. */
  soloShare: number;
}

/**
 * Taux de victoire selon le nombre de joueurs du clan dans la partie.
 * Une taille sous `minGames` parties n'est pas retenue. Renvoie null si les données
 * ne montrent pas de gain entre la plus petite et la plus grande taille retenue :
 * le message du bloc ne serait alors plus vrai.
 */
export function groupStats(sessions: readonly StoredSession[], minGames = 30): GroupStats | null {
  const played = sessions.filter((s) => s.clanPlayerCount >= 1);
  const sizes = GROUP_SIZES.flatMap(({ label, min, max }) => {
    const rows = played.filter((s) => s.clanPlayerCount >= min && s.clanPlayerCount <= max);
    const wins = rows.filter((s) => s.hasWon).length;
    const rate = winRate(wins, rows.length);
    return rate === null || rows.length < minGames ? [] : [{ label, games: rows.length, wins, winRate: rate }];
  });
  const first = sizes[0];
  const last = sizes[sizes.length - 1];
  if (!first || !last || first === last || last.winRate <= first.winRate) return null;
  const solo = played.filter((s) => s.clanPlayerCount === 1).length;
  return { sizes, games: played.length, soloShare: (solo / played.length) * 100 };
}

export const HEATMAP_DAYS = 90;

export interface Heatmap {
  /** grid[jour][heure], avec jour 0 = lundi, heure de Paris. */
  grid: number[][];
  /** Somme des joueurs du clan, pour la moyenne par créneau. */
  players: number[][];
  total: number;
  max: number;
  from: string;
  to: string;
}

/** Heatmap des parties enregistrées sur les `HEATMAP_DAYS` derniers jours couverts. */
export function buildHeatmap(sessions: readonly StoredSession[], coveredUntil: string | null): Heatmap | null {
  if (!coveredUntil) return null;
  const to = parisParts(coveredUntil).date;
  const from = addDays(to, -(HEATMAP_DAYS - 1));
  const zeros = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const grid = zeros();
  const players = zeros();
  let total = 0;
  for (const s of sessions) {
    const p = parisParts(s.gameStart);
    if (p.date < from || p.date > to) continue;
    const row = grid[p.weekday];
    const prow = players[p.weekday];
    if (!row || !prow) continue;
    row[p.hour] = (row[p.hour] ?? 0) + 1;
    prow[p.hour] = (prow[p.hour] ?? 0) + s.clanPlayerCount;
    total++;
  }
  return { grid, players, total, max: Math.max(0, ...grid.flat()), from, to };
}

export interface Slot {
  weekday: number;
  hour: number;
  games: number;
  avgPlayers: number;
}

/**
 * Meilleurs créneaux : ceux qui comptent le plus de parties enregistrées,
 * puis le plus de joueurs du clan par partie en cas d'égalité.
 * Un créneau sous `minGames` parties n'est pas retenu.
 */
export function bestSlots(map: Heatmap | null, count = 5, minGames = 5): Slot[] {
  if (!map) return [];
  const slots: Slot[] = [];
  map.grid.forEach((row, weekday) =>
    row.forEach((games, hour) => {
      if (games >= minGames) {
        slots.push({ weekday, hour, games, avgPlayers: (map.players[weekday]?.[hour] ?? 0) / games });
      }
    }),
  );
  return slots
    .sort((a, b) => b.games - a.games || b.avgPlayers - a.avgPlayers || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, count);
}
