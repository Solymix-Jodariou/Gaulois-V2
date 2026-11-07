import type { StoredSession } from "./schemas";
import { winRate } from "./stats";
import { addDays, parisParts } from "./time";

/** Même fenêtre que le classement officiel, pour décrire le clan tel qu'il joue aujourd'hui. */
export const RESULTS_DAYS = 90;

export interface FormatResult {
  key: string;
  label: string;
  games: number;
  wins: number;
  winRate: number;
  /** Taux d'une équipe prise au hasard, en % : moyenne de 1 ÷ nombre d'équipes sur ces parties. */
  chance: number | null;
  /** Mêmes chiffres depuis le début de l'archive. */
  allTime: { games: number; winRate: number };
}

export interface FormatResults {
  /** Formats à nombre d'équipes fixe : « 2 » signifie deux équipes. */
  byTeams: FormatResult[];
  /** Formats à taille d'équipe fixe : Duos, Trios, Quads. */
  bySize: FormatResult[];
  from: string;
  to: string;
}

const SIZE_FORMATS = ["Duos", "Trios", "Quads"];

const label = (key: string) => (/^\d+$/.test(key) ? `${key} équipes` : key);

function tally(sessions: readonly StoredSession[]) {
  const rows = new Map<string, { games: number; wins: number; chanceSum: number; chanceGames: number }>();
  for (const s of sessions) {
    if (s.playerTeams === null) continue;
    const row = rows.get(s.playerTeams) ?? { games: 0, wins: 0, chanceSum: 0, chanceGames: 0 };
    row.games++;
    if (s.hasWon) row.wins++;
    if (s.numTeams >= 2) {
      row.chanceSum += 1 / s.numTeams;
      row.chanceGames++;
    }
    rows.set(s.playerTeams, row);
  }
  return rows;
}

/**
 * Taux de victoire par format, sur les `RESULTS_DAYS` derniers jours couverts.
 * Un format sous `minGames` parties sur cette fenêtre n'est pas retenu.
 * Le repère de hasard est indispensable : gagner 48 % à 2 équipes vaut moins que 33 % à 7 équipes.
 */
export function formatResults(sessions: readonly StoredSession[], coveredUntil: string | null, minGames = 30): FormatResults | null {
  if (!coveredUntil) return null;
  const to = parisParts(coveredUntil).date;
  const from = addDays(to, -(RESULTS_DAYS - 1));
  const recent = tally(
    sessions.filter((s) => {
      const day = parisParts(s.gameStart).date;
      return day >= from && day <= to;
    }),
  );
  const allTime = tally(sessions);
  const rows = [...recent].flatMap(([key, r]) => {
    const rate = winRate(r.wins, r.games);
    const total = allTime.get(key);
    const totalRate = total ? winRate(total.wins, total.games) : null;
    if (r.games < minGames || rate === null || !total || totalRate === null) return [];
    const row: FormatResult = {
      key,
      label: label(key),
      games: r.games,
      wins: r.wins,
      winRate: rate,
      chance: r.chanceGames > 0 ? (r.chanceSum / r.chanceGames) * 100 : null,
      allTime: { games: total.games, winRate: totalRate },
    };
    return [row];
  });
  if (rows.length === 0) return null;
  const sizeIndex = (key: string) => SIZE_FORMATS.indexOf(key);
  return {
    byTeams: rows.filter((r) => sizeIndex(r.key) < 0).sort((a, b) => Number(a.key) - Number(b.key) || a.key.localeCompare(b.key)),
    bySize: rows.filter((r) => sizeIndex(r.key) >= 0).sort((a, b) => sizeIndex(a.key) - sizeIndex(b.key)),
    from,
    to,
  };
}

export interface ClanRecords {
  streak: { wins: number; endedAt: string };
  bestDay: { date: string; wins: number; games: number };
  biggestGroup: { players: number; at: string };
  mostTeams: { teams: number; players: number; at: string };
}

/**
 * Records du clan sur l'archive. Une partie jouée seul contre des robots ne compte pas : elle fausserait
 * les records. Aucun record de score : ces parties y arrivaient en tête.
 * `clanPlayerCount` compte tous les joueurs du clan de la partie, même dans une équipe perdante.
 * `null` sans victoire : pas de records à montrer.
 */
export function clanRecords(sessions: readonly StoredSession[]): ClanRecords | null {
  const played = sessions.filter((s) => s.totalPlayerCount >= 2).sort((a, b) => a.gameStart.localeCompare(b.gameStart));
  const wins = played.filter((s) => s.hasWon);
  const first = wins[0];
  if (!first) return null;

  let current = 0;
  let streak = { wins: 0, endedAt: first.gameStart };
  const days = new Map<string, { wins: number; games: number }>();
  for (const s of played) {
    current = s.hasWon ? current + 1 : 0;
    if (current > streak.wins) streak = { wins: current, endedAt: s.gameStart };
    const date = parisParts(s.gameStart).date;
    const day = days.get(date) ?? { wins: 0, games: 0 };
    day.games++;
    if (s.hasWon) day.wins++;
    days.set(date, day);
  }

  let bestDay = { date: parisParts(first.gameStart).date, wins: 0, games: 0 };
  for (const [date, day] of days) {
    if (day.wins > bestDay.wins) bestDay = { date, ...day };
  }

  let group = first;
  let teams = first;
  for (const s of wins) {
    if (s.clanPlayerCount > group.clanPlayerCount) group = s;
    if (s.numTeams > teams.numTeams) teams = s;
  }
  return {
    streak,
    bestDay,
    biggestGroup: { players: group.clanPlayerCount, at: group.gameStart },
    mostTeams: { teams: teams.numTeams, players: teams.totalPlayerCount, at: teams.gameStart },
  };
}
