/**
 * Détail des parties : ce que le site en garde, puis les résultats par carte et les face-à-face.
 *
 * `placeClans` est adapté de `assignTeams` dans OpenFront (packages/engine-lib/src/game/TeamAssignment.ts,
 * commit 31a2119, AGPL-3.0, © OpenFront and Contributors), réécrit et réduit au placement des clans
 * le 7 novembre 2026. Mesures et limites : docs/API_AUDIT.md.
 */
import { resultsWindow } from "./results";
import type { ApiGame, StoredGame, StoredSession } from "./schemas";
import { winRate } from "./stats";

/** En dessous, un tag n'est pas un groupe : il peut désigner une seule personne, et ne fait pas un face-à-face. */
export const MIN_CLAN_PLAYERS = 2;
export const MAP_MIN_GAMES = 50;
/** Une carte n'est dite forte ou faible qu'à partir de cet écart. La page recalcule une quarantaine de cartes chaque jour : un seuil plus bas donnerait de fausses alertes. Mesures : docs/API_AUDIT.md. */
export const MAP_SIGNAL_Z = 4;
/** 4 joueurs ou plus forment une seule catégorie : plus fin, il resterait trop peu de parties dans chacune. */
const GROUP_CAP = 4;
/** Tranches de taille de salon, en joueurs. Le taux du clan en dépend, et la taille du salon dépend de la carte. */
const LOBBY_LIMITS = [20, 40, 80];
export const FACE_OFF_MIN_MEETINGS = 30;
export const FACE_OFF_MAX_ROWS = 12;
/** Au-delà de cette part de parties écartées parmi les plus récentes, la règle de placement du jeu a sans doute changé. */
export const FACE_OFF_MAX_DOUBT = 0.05;
/** Le contrôle porte sur les dernières parties, pour réagir vite à un changement, et attend d'en avoir assez pour juger. */
const FACE_OFF_CHECKED = 200;
const FACE_OFF_MIN_CHECKED = 50;
/** Si peu de parties à lire ne changent plus rien : une partie toute récente, ou une partie qui ne répond pas et qui sera relue. */
const NEARLY_READ = 20;

const COLOR_TEAMS = ["Red", "Blue", "Yellow", "Green", "Purple", "Orange", "Teal"];
const teamName = (index: number, numTeams: number) => (numTeams < 8 ? COLOR_TEAMS[index] : `Team ${index + 1}`);
const TEAM_SIZES: Record<string, number> = { Duos: 2, Trios: 3, Quads: 4 };

/**
 * L'équipe de chaque clan, comme le jeu la choisit : tout le clan dans une seule équipe, le plus gros clan d'abord,
 * dans l'équipe la moins remplie. `tags` : le tag de chaque joueur, dans l'ordre de la partie. À taille égale, le premier arrivé passe d'abord.
 * Le jeu laisse dehors le surplus d'un clan qui ne rentre pas dans la place restante. Cela ne change pas le choix suivant :
 * une équipe pleine n'est jamais la moins remplie tant qu'il reste quelqu'un à placer.
 */
export function placeClans(tags: readonly (string | null)[], numTeams: number): Map<string, number> {
  const placed = new Map<string, number>();
  if (numTeams < 2) return placed;
  const sizes = new Map<string, number>();
  for (const tag of tags) if (tag) sizes.set(tag, (sizes.get(tag) ?? 0) + 1);
  const filled = new Array<number>(numTeams).fill(0);
  for (const [tag, size] of [...sizes].sort((a, b) => b[1] - a[1])) {
    const team = filled.indexOf(Math.min(...filled));
    filled[team] = (filled[team] ?? 0) + size;
    placed.set(tag, team);
  }
  return placed;
}

/**
 * Ce que le site garde d'une partie. L'API ne donne pas encore l'équipe des perdants, et sa liste de vainqueurs oublie les joueurs
 * partis avant la fin : l'équipe de chaque clan vient de `placeClans`, ou de la fiche du joueur quand le jeu l'y écrit.
 * Elle n'est gardée que si elle concorde avec tous les vainqueurs officiels et avec le résultat de la session ; sinon, `win` vaut `null`.
 */
export function digestGame({ info }: ApiGame, session: StoredSession, tag: string): StoredGame {
  // En Duos, Trios et Quads, le jeu compte les équipes sur tous les joueurs de la fiche. La session, elle, ne retient que ceux qui ont des stats.
  const size = TEAM_SIZES[session.playerTeams ?? ""];
  const numTeams = size ? Math.max(2, Math.ceil(info.players.length / size)) : session.numTeams;
  const names = Array.from({ length: numTeams }, (_, i) => teamName(i, numTeams));
  const placed = placeClans(info.players.map((p) => p.clanTag), numTeams);
  const [kind, teamWon, ...winnerIds] = info.winner ?? [];
  const winners = new Set(winnerIds);
  const tally = new Map<string, { withStats: number; won: number }>();
  const written = new Map<string, number>();
  let splitClan = false;
  for (const p of info.players) {
    if (!p.clanTag) continue;
    const row = tally.get(p.clanTag) ?? { withStats: 0, won: 0 };
    if (p.hasStats) row.withStats++;
    if (p.clientID && winners.has(p.clientID)) row.won++;
    tally.set(p.clanTag, row);
    const team = p.team ? names.indexOf(p.team) : -1;
    if (team < 0) continue;
    if (written.has(p.clanTag) && written.get(p.clanTag) !== team) splitClan = true;
    written.set(p.clanTag, team);
    placed.set(p.clanTag, team);
  }
  const win = kind === "team" ? names.indexOf(teamWon) : -1;
  const coherent = !splitClan && win >= 0 && [...tally].every(([t, row]) => row.won === 0 || placed.get(t) === win) && (placed.get(tag) === win) === session.hasWon;
  return {
    id: session.gameId,
    map: info.config.gameMap,
    seconds: Math.round(info.duration),
    win: coherent ? win : null,
    clans: coherent
      ? [...tally].flatMap(([t, row]): StoredGame["clans"] => {
          const team = placed.get(t);
          return team !== undefined && (t === tag || row.withStats >= MIN_CLAN_PLAYERS) ? [[t, row.withStats, team]] : [];
        })
      : [],
  };
}

export interface GameCoverage {
  total: number;
  read: number;
}

export interface ReadingState {
  /** Sur la période affichée. */
  coverage: GameCoverage;
  /** Depuis le début de l'archive. */
  archive: GameCoverage;
  /** Vrai tant qu'il reste assez de parties à lire pour que les chiffres changent encore. */
  reading: boolean;
}

/** Les parties jouées à plusieurs, chacune avec son détail s'il est lu. Une partie seul contre des robots fausserait les résultats. */
function withDetails(sessions: readonly StoredSession[], games: readonly StoredGame[]) {
  const byId = new Map(games.map((g) => [g.id, g]));
  return sessions.filter((s) => s.totalPlayerCount >= 2 && s.numTeams >= 2).map((session) => ({ session, game: byId.get(session.gameId) ?? null }));
}
type Entry = ReturnType<typeof withDetails>[number];

const coverageOf = (entries: readonly Entry[]): GameCoverage => ({ total: entries.length, read: entries.filter((e) => e.game).length });

function readingState(all: readonly Entry[], recent: readonly Entry[]): ReadingState {
  const archive = coverageOf(all);
  return { coverage: coverageOf(recent), archive, reading: archive.total - archive.read > NEARLY_READ };
}

export interface MapResult {
  map: string;
  games: number;
  wins: number;
  winRate: number;
  /** Ce que le clan gagne d'habitude sur ces mêmes parties, en % : son taux au même format, avec autant de joueurs, dans un salon de taille proche. */
  usual: number;
  /** L'écart avec `usual`, rapporté à ce que le hasard peut produire sur ce nombre de parties. */
  z: number;
  medianSeconds: number;
  /** Depuis le début de l'archive. `null` tant qu'il reste trop de parties à lire. */
  allTime: { games: number; winRate: number } | null;
}

export interface MapResults extends ReadingState {
  /** Des cartes les plus jouées aux moins jouées. */
  rows: MapResult[];
  /** Les seules cartes dont l'écart avec les habitudes du clan ne s'explique plus par le hasard. Le plus souvent, aucune. */
  strong: MapResult[];
  weak: MapResult[];
  from: string;
  to: string;
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? high : ((sorted[middle - 1] ?? high) + high) / 2;
}

/** Le taux du clan sur ces parties, par format, nombre de joueurs du clan et taille de salon : ce que donnerait une carte sans aucun effet. */
function usualRates(list: readonly Entry[]) {
  const lobby = (players: number) => LOBBY_LIMITS.filter((limit) => players > limit).length;
  const key = ({ session }: Entry) => `${session.playerTeams}|${Math.min(session.clanPlayerCount, GROUP_CAP)}|${lobby(session.totalPlayerCount)}`;
  const cells = new Map<string, { wins: number; games: number }>();
  for (const entry of list) {
    const cell = cells.get(key(entry)) ?? { wins: 0, games: 0 };
    cell.games++;
    if (entry.session.hasWon) cell.wins++;
    cells.set(key(entry), cell);
  }
  return (entry: Entry) => {
    const cell = cells.get(key(entry));
    return cell ? cell.wins / cell.games : 0;
  };
}

/**
 * Taux de victoire par carte sur les `RESULTS_DAYS` derniers jours. Une carte sous `minGames` parties sur cette fenêtre n'est pas retenue.
 * Comparer les taux entre eux ou au hasard ne dirait rien : le format, la taille du salon et le nombre de joueurs du clan pèsent davantage,
 * et les deux premiers changent d'une carte à l'autre. Chaque carte est donc comparée au taux habituel du clan dans les mêmes conditions.
 */
export function mapResults(sessions: readonly StoredSession[], games: readonly StoredGame[], coveredUntil: string | null, minGames = MAP_MIN_GAMES): MapResults | null {
  if (!coveredUntil) return null;
  const { from, to, includes } = resultsWindow(coveredUntil);
  const entries = withDetails(sessions, games);
  const recent = entries.filter((e) => includes(e.session.gameStart));
  const state = readingState(entries, recent);

  const allTime = new Map<string, { wins: number; games: number }>();
  for (const { session, game } of entries) {
    if (!game) continue;
    const row = allTime.get(game.map) ?? { wins: 0, games: 0 };
    row.games++;
    if (session.hasWon) row.wins++;
    allTime.set(game.map, row);
  }

  const usual = usualRates(recent.filter((e) => e.game));
  const maps = new Map<string, { wins: number; expected: number; variance: number; seconds: number[] }>();
  for (const entry of recent) {
    if (!entry.game) continue;
    const row = maps.get(entry.game.map) ?? { wins: 0, expected: 0, variance: 0, seconds: [] };
    const rate = usual(entry);
    if (entry.session.hasWon) row.wins++;
    row.expected += rate;
    row.variance += rate * (1 - rate);
    row.seconds.push(entry.game.seconds);
    maps.set(entry.game.map, row);
  }

  const rows = [...maps].flatMap(([map, row]): MapResult[] => {
    const played = row.seconds.length;
    const rate = winRate(row.wins, played);
    if (played < minGames || rate === null) return [];
    const total = allTime.get(map);
    const totalRate = total ? winRate(total.wins, total.games) : null;
    return [
      {
        map,
        games: played,
        wins: row.wins,
        winRate: rate,
        usual: (row.expected / played) * 100,
        z: row.variance > 0 ? (row.wins - row.expected) / Math.sqrt(row.variance) : 0,
        medianSeconds: median(row.seconds.sort((a, b) => a - b)),
        allTime: !state.reading && total && totalRate !== null ? { games: total.games, winRate: totalRate } : null,
      },
    ];
  });
  rows.sort((a, b) => b.games - a.games || a.map.localeCompare(b.map));
  return {
    rows,
    strong: rows.filter((r) => r.z >= MAP_SIGNAL_Z).sort((a, b) => b.z - a.z),
    weak: rows.filter((r) => r.z <= -MAP_SIGNAL_Z).sort((a, b) => a.z - b.z),
    from,
    to,
    ...state,
  };
}

export interface FaceOffCount {
  /** Parties dans des équipes différentes. */
  meetings: number;
  /** Gagnées par l'équipe du clan du site. Un clan n'est pas seul dans son équipe. */
  ours: number;
  /** Gagnées par l'équipe de l'autre clan. */
  theirs: number;
  /** Gagnées par une troisième équipe. */
  others: number;
}

export interface FaceOff extends FaceOffCount {
  tag: string;
  /** Quand l'équipe de l'un des deux gagne, part de celle du clan du site, en %. `null` si aucune des deux n'a gagné. */
  share: number | null;
  /** Depuis le début de l'archive. `null` tant qu'il reste trop de parties à lire. */
  allTime: FaceOffCount | null;
}

export interface FaceOffs extends ReadingState {
  /** Des clans les plus aux moins souvent rencontrés. */
  rows: FaceOff[];
  from: string;
  to: string;
  /** Parties du clan à au moins `MIN_CLAN_PLAYERS` joueurs lues sur la période, et celles écartées faute de concordance. */
  considered: number;
  doubtful: number;
  /** Les parties les plus récentes sur lesquelles porte le contrôle, et combien sont écartées. */
  checked: number;
  checkedDoubtful: number;
  /** Faux : trop de parties récentes écartées, la méthode n'est plus sûre et les chiffres ne doivent pas être montrés. */
  reliable: boolean;
}

/**
 * Bilan contre chaque clan de `officialTags` : les parties où les deux avaient au moins `MIN_CLAN_PLAYERS` joueurs,
 * dans des équipes différentes. Un clan sous `minMeetings` parties sur la période n'est pas retenu.
 */
export function faceOffs(sessions: readonly StoredSession[], games: readonly StoredGame[], tag: string, officialTags: readonly string[], coveredUntil: string | null, minMeetings = FACE_OFF_MIN_MEETINGS): FaceOffs | null {
  if (!coveredUntil) return null;
  const { from, to, includes } = resultsWindow(coveredUntil);
  const official = new Set(officialTags);
  const entries = withDetails(sessions, games);
  const recent = entries.filter((e) => includes(e.session.gameStart));
  const state = readingState(entries, recent);

  const tally = (list: readonly Entry[]) => {
    const rivals = new Map<string, FaceOffCount>();
    for (const { game } of list) {
      if (!game || game.win === null) continue;
      const ours = game.clans.find(([t]) => t === tag);
      if (!ours || ours[1] < MIN_CLAN_PLAYERS) continue;
      for (const [rival, players, team] of game.clans) {
        if (rival === tag || players < MIN_CLAN_PLAYERS || team === ours[2] || !official.has(rival)) continue;
        const row = rivals.get(rival) ?? { meetings: 0, ours: 0, theirs: 0, others: 0 };
        row.meetings++;
        if (game.win === ours[2]) row.ours++;
        else if (game.win === team) row.theirs++;
        else row.others++;
        rivals.set(rival, row);
      }
    }
    return rivals;
  };

  const allTime = tally(entries);
  const rows = [...tally(recent)]
    .filter(([, row]) => row.meetings >= minMeetings)
    .sort(([a, x], [b, y]) => y.meetings - x.meetings || a.localeCompare(b))
    .slice(0, FACE_OFF_MAX_ROWS)
    .map(([rival, row]): FaceOff => ({ tag: rival, ...row, share: winRate(row.ours, row.ours + row.theirs), allTime: state.reading ? null : (allTime.get(rival) ?? null) }));

  const group = recent.filter((e) => e.game && e.session.clanPlayerCount >= MIN_CLAN_PLAYERS);
  const latest = [...group].sort((a, b) => b.session.gameStart.localeCompare(a.session.gameStart)).slice(0, FACE_OFF_CHECKED);
  const checkedDoubtful = latest.filter((e) => e.game?.win === null).length;
  return {
    rows,
    from,
    to,
    ...state,
    considered: group.length,
    doubtful: group.filter((e) => e.game?.win === null).length,
    checked: latest.length,
    checkedDoubtful,
    reliable: latest.length < FACE_OFF_MIN_CHECKED || checkedDoubtful <= latest.length * FACE_OFF_MAX_DOUBT,
  };
}
