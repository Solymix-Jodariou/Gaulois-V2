import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { digestGame } from "./games";
import {
  ApiClanExists,
  ApiDeletedPlayers,
  ApiGame,
  ApiLeaderboard,
  ApiMembersPage,
  ApiPlayerGames,
  ApiRankedPage,
  ApiSessionsPage,
  Meta,
  StoredGame,
  StoredGameFile,
  StoredMemberGames,
  StoredMemberRecent,
  StoredMembers,
  StoredSessionFile,
  emptyMeta,
  type DatasetState,
  type HistorySnapshot,
  type RivalsSnapshot,
  type StoredLeaderboard,
  type StoredMemberGame,
  type StoredSession,
} from "./schemas";
import { gamesOf, MEMBER_RECENT_GAMES, memberGamesUnderTag, toStoredMember } from "./members";
import { RANKED_MODES, rankedCounts } from "./ranked";
import { mergeSessions } from "./sessions";
import { findClan, withOfficialRanks } from "./stats";
import { addDays, parisParts } from "./time";

export const API_ORIGIN = "https://api.openfront.io";
export const API_BASE = `${API_ORIGIN}/public`;
const PAGE_SIZE = 50;
/** Délai après la fin d'un jour UTC avant de le considérer comme définitif. */
const SETTLE_MS = 6 * 3_600_000;
/** Les membres ne sont relus qu'une fois par jour : le fichier est lourd pour Git. */
const MEMBERS_MIN_INTERVAL_MS = 20 * 3_600_000;
/** Parties lues par passage : environ 4 minutes. L'archive se lit donc en un jour ou deux, sans charger l'API. */
const GAMES_PER_RUN = 400;
/** Au-delà dans un passage, le problème vient de l'API : inutile d'insister. Assez haut pour que quelques parties cassées, toujours en tête de file, ne bloquent pas les plus anciennes. */
const MAX_FAILURES_PER_RUN = 25;
/** À partir de ce nombre d'échecs sans aucune partie lue, c'est une panne à signaler, même quand il n'y a que quelques nouvelles parties à lire. */
const OUTAGE_FAILURES = 5;
/** Appels par passage pour les fiches des membres, environ : un joueur commencé est lu jusqu'au bout. Moins de 3 minutes. */
const MEMBER_CALLS_PER_RUN = 150;
/** Pages lues au plus pour un joueur, de 10 parties chacune. Plus loin, ce qu'il a joué sous le tag est ancien : la fiche le dit. */
const MEMBER_PAGES_MAX = 3;

export interface Deps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  dataDir: string;
  tag: string;
  archiveStart: string;
  delayMs: number;
  gamesPerRun?: number;
  memberCallsPerRun?: number;
  /** Les parties de chaque membre : hors de `data/`, donc hors de Git. */
  memberGamesFile: string;
  log: (msg: string) => void;
}

export class ApiClient {
  constructor(private deps: Deps) {}

  /** Espace les appels et réessaie sur 429 ou 5xx, avec un délai croissant. */
  private async request(url: string, path: string): Promise<Response> {
    const { fetch: f, sleep, delayMs } = this.deps;
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(attempt === 0 ? delayMs : delayMs * 2 ** (attempt + 2));
      let res: Response;
      try {
        res = await f(url, { headers: { "User-Agent": "GAL-clan-site/1.0" } });
      } catch (e) {
        lastError = `réseau : ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
      return res;
    }
    throw new Error(`${lastError} sur ${path} après 4 essais`);
  }

  async getJson(path: string, base: string = API_BASE): Promise<unknown> {
    const res = await this.request(`${base}${path}`, path);
    return res.json();
  }

  async get<S extends z.ZodType>(path: string, schema: S, base: string = API_BASE): Promise<z.output<S>> {
    const parsed = schema.safeParse(await this.getJson(path, base));
    if (!parsed.success) throw new Error(`réponse invalide sur ${path} : ${parsed.error.message.slice(0, 300)}`);
    return parsed.data;
  }

  async getBytes(path: string, base: string = API_BASE): Promise<Uint8Array> {
    const res = await this.request(`${base}${path}`, path);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, "utf8");
  await rename(tmp, path);
}

export async function readJson<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S> | null> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

export function markOk(state: DatasetState, at: string): void {
  state.lastSuccessAt = at;
  state.lastError = null;
}
export function markError(state: DatasetState, at: string, e: unknown): string {
  state.lastErrorAt = at;
  state.lastError = e instanceof Error ? e.message : String(e);
  return state.lastError;
}

async function fetchLeaderboard(api: ApiClient, deps: Deps, at: string): Promise<StoredLeaderboard> {
  const data = await api.get("/clans/leaderboard", ApiLeaderboard);
  const stored: StoredLeaderboard = { ...data, fetchedAt: at };
  await writeJson(join(deps.dataDir, "leaderboard.json"), stored);
  return stored;
}

async function fetchMembers(api: ApiClient, deps: Deps, at: string): Promise<number> {
  const all = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await api.get(`/clan/${deps.tag}/members?page=${page}&limit=${PAGE_SIZE}`, ApiMembersPage);
    total = res.total;
    all.push(...res.results);
    if (res.results.length === 0 || all.length >= total) break;
  }
  const unique = new Map(all.map((m) => [m.publicId, m]));
  // Une liste incomplète ne remplace jamais la dernière liste valide.
  if (total === 0 || unique.size < total) {
    throw new Error(`liste des membres incomplète : ${unique.size} reçus pour ${total} annoncés`);
  }
  await writeJson(join(deps.dataDir, "members.json"), {
    fetchedAt: at,
    total,
    members: [...unique.values()].map(toStoredMember),
  });
  return total;
}

/** Les deux pages du classement classé, croisées avec le roster : les deux doivent répondre, sinon rien n'est remplacé. */
async function fetchRanked(api: ApiClient, deps: Deps, at: string, members: StoredMembers): Promise<number> {
  const pages = [await api.get("/leaderboard/ranked?page=1", ApiRankedPage), await api.get("/leaderboard/ranked?page=2", ApiRankedPage)];
  const ranked = rankedCounts(pages, members.members, at);
  // Un mode vide n'est pas « aucun membre » : il ne remplace jamais le dernier relevé valide.
  const empty = RANKED_MODES.filter(({ key }) => ranked.modes[key].listed === 0).map(({ label }) => label);
  if (empty.length > 0) throw new Error(`classement classé vide : ${empty.join(", ")}`);
  await writeJson(join(deps.dataDir, "ranked.json"), ranked);
  return RANKED_MODES.reduce((n, { key }) => n + ranked.modes[key].members, 0);
}

export async function fetchDaySessions(api: ApiClient, tag: string, day: string): Promise<StoredSession[]> {
  const q = `start=${day}T00:00:00.000Z&end=${day}T23:59:59.999Z&limit=${PAGE_SIZE}`;
  const byId = new Map<string, StoredSession>();
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await api.get(`/clan/${tag}/sessions?${q}&page=${page}`, ApiSessionsPage);
    total = res.total;
    for (const r of res.results) {
      byId.set(r.gameId, {
        gameId: r.gameId,
        clanPlayerCount: r.clanPlayerCount,
        hasWon: r.hasWon,
        numTeams: r.numTeams,
        playerTeams: r.playerTeams,
        totalPlayerCount: r.totalPlayerCount,
        gameStart: r.gameStart,
        score: r.score,
      });
    }
    if (res.results.length === 0 || byId.size >= total) break;
  }
  if (byId.size < total) throw new Error(`sessions du ${day} incomplètes : ${byId.size} sur ${total}`);
  return [...byId.values()];
}

async function fetchSessions(api: ApiClient, deps: Deps, meta: Meta): Promise<void> {
  const state = meta.sessions;
  const started = deps.now();
  const today = started.toISOString().slice(0, 10);
  const dir = join(deps.dataDir, "sessions");
  await mkdir(dir, { recursive: true });
  const first = state.completeThrough ? addDays(state.completeThrough, 1) : deps.archiveStart;
  let settling = true;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const rows = await fetchDaySessions(api, deps.tag, day);
    if (rows.length > 0) {
      const month = day.slice(0, 7);
      const path = join(dir, `${month}.json`);
      const current = await readJson(path, StoredSessionFile);
      await writeJson(path, { month, sessions: mergeSessions(current?.sessions ?? [], rows) });
    }
    const dayEnd = Date.parse(`${day}T23:59:59.999Z`);
    if (settling && dayEnd + SETTLE_MS < started.getTime()) state.completeThrough = day;
    else settling = false;
    // Chaque jour lu est sans trou : un échec plus tard n'efface pas ce progrès.
    state.coveredUntil = new Date(Math.min(dayEnd, started.getTime())).toISOString();
  }
}

async function jsonNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".json"));
}

/**
 * Le détail des parties pas encore lues, des plus récentes aux plus anciennes : une partie finie ne change plus, elle n'est lue qu'une fois.
 * Une partie qui ne répond pas, même en 404, reste simplement à lire : rien de définitif n'est écrit, donc une panne ne peut rien fausser.
 * Ce qui est déjà lu reste acquis si la lecture s'arrête en route.
 */
export async function fetchGames(api: ApiClient, deps: Deps): Promise<{ read: number; left: number; unreadable: number }> {
  const dir = join(deps.dataDir, "games");
  await mkdir(dir, { recursive: true });
  const files = new Map<string, StoredGameFile>();
  for (const name of await jsonNames(dir)) {
    const file = await readJson(join(dir, name), StoredGameFile);
    if (file) files.set(file.month, file);
  }
  const known = new Set([...files.values()].flatMap((f) => f.games.map((g) => g.id)));

  const sessionsDir = join(deps.dataDir, "sessions");
  const sessions: StoredSession[] = [];
  for (const name of await jsonNames(sessionsDir)) {
    sessions.push(...((await readJson(join(sessionsDir, name), StoredSessionFile))?.sessions ?? []));
  }
  const todo = sessions.filter((s) => !known.has(s.gameId)).sort((a, b) => b.gameStart.localeCompare(a.gameStart));

  const touched = new Set<string>();
  let read = 0;
  let unreadable = 0;
  let lastFailure = "";
  try {
    for (const session of todo.slice(0, deps.gamesPerRun ?? GAMES_PER_RUN)) {
      if (unreadable >= MAX_FAILURES_PER_RUN) break;
      try {
        const game = ApiGame.parse(await api.getJson(`/game/${encodeURIComponent(session.gameId)}?turns=false`));
        // Une seule ligne invalide ferait rejeter tout le fichier du mois à la lecture.
        const stored = StoredGame.parse(digestGame(game, session, deps.tag));
        const month = session.gameStart.slice(0, 7);
        const file = files.get(month) ?? { month, games: [] };
        file.games.push(stored);
        files.set(month, file);
        touched.add(month);
        read++;
      } catch (e) {
        unreadable++;
        lastFailure = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        deps.log(`partie sans réponse lisible, ${session.gameId} : ${lastFailure}`);
      }
    }
  } finally {
    for (const month of touched) await writeJson(join(dir, `${month}.json`), files.get(month));
  }
  if (unreadable >= MAX_FAILURES_PER_RUN || (read === 0 && unreadable >= OUTAGE_FAILURES)) {
    throw new Error(`${unreadable} parties sans réponse lisible, ${read} lues, dernière erreur : ${lastFailure}`);
  }
  return { read, left: todo.length - read, unreadable };
}

/** Retire les comptes supprimés de la liste des membres, comme le demande OpenFront, sans attendre sa relecture quotidienne. */
async function dropDeletedMembers(api: ApiClient, deps: Deps, members: StoredMembers): Promise<StoredMembers> {
  const deleted = new Set((await api.get("/players/recently-deleted", ApiDeletedPlayers)).map((d) => d.publicId));
  const kept = members.members.filter((m) => !m.publicId || !deleted.has(m.publicId));
  const removed = members.members.length - kept.length;
  if (removed === 0) return members;
  const cleaned = { ...members, total: members.total - removed, members: kept };
  await writeJson(join(deps.dataDir, "members.json"), cleaned);
  deps.log(`comptes supprimés retirés de la liste : ${removed}`);
  return cleaned;
}

async function writeMemberGames(deps: Deps, players: ReadonlyMap<string, StoredMemberRecent>): Promise<void> {
  await mkdir(dirname(deps.memberGamesFile), { recursive: true });
  await writeJson(deps.memberGamesFile, Object.fromEntries(players));
}

/**
 * Oublie un membre parti, ou qui a retiré son pseudo : il n'a plus de fiche, et son identifiant ne doit rester nulle part.
 * Aucun appel à l'API : cela reste vrai quand une route est en panne.
 */
async function forgetFormerMembers(deps: Deps, members: StoredMembers): Promise<Map<string, StoredMemberRecent>> {
  const stored = (await readJson(deps.memberGamesFile, StoredMemberGames)) ?? {};
  const current = new Set(members.members.flatMap((m) => (m.username && m.publicId ? [m.publicId] : [])));
  const players = new Map(Object.entries(stored).filter(([id]) => current.has(id)));
  if (players.size !== Object.keys(stored).length) await writeMemberGames(deps, players);
  return players;
}

/** Les dernières parties sous le tag des membres avec pseudo. Tant que ses parties selon `stats.team` ne bougent pas, un joueur n'est pas relu. Rien n'est écrit pour un anonyme. */
export async function fetchMemberGames(api: ApiClient, deps: Deps, members: StoredMembers): Promise<{ read: number; left: number; unreadable: number }> {
  const players = await forgetFormerMembers(deps, members);
  const named = members.members.flatMap((m) => (m.username && m.publicId ? [{ id: m.publicId, games: gamesOf(m) ?? 0 }] : []));

  // Ceux jamais lus d'abord : tant qu'ils n'ont rien, leur fiche ne montre aucune partie.
  const todo = named.filter((m) => m.games > 0 && players.get(m.id)?.seen !== m.games).sort((a, b) => Number(players.has(a.id)) - Number(players.has(b.id)));
  const today = parisParts(deps.now()).date;
  const budget = deps.memberCallsPerRun ?? MEMBER_CALLS_PER_RUN;
  let calls = 0;
  let read = 0;
  let unreadable = 0;
  let lastFailure = "";
  let changed = false;
  try {
    for (const { id, games } of todo) {
      if (calls >= budget || unreadable >= MAX_FAILURES_PER_RUN) break;
      try {
        const wanted = Math.min(games, MEMBER_RECENT_GAMES);
        const rows = [];
        let found: StoredMemberGame[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const query: string = `filter=team&type=public${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          calls++;
          pages++;
          const page = await api.get(`/player/${encodeURIComponent(id)}/games?${query}`, ApiPlayerGames);
          rows.push(...page.results);
          found = memberGamesUnderTag(rows, deps.tag);
          cursor = page.nextCursor;
        } while (cursor && pages < MEMBER_PAGES_MAX && found.length < wanted);
        // Tout son historique est lu sans y trouver ce que dit `stats.team` : c'est la réponse qui se trompe. Ce qui est déjà gardé reste.
        if (cursor === null && found.length < wanted) throw new Error(`réponse incomplète : ${found.length} parties pour ${wanted} attendues`);
        players.set(id, StoredMemberRecent.parse({ seen: games, readOn: today, recent: found }));
        changed = true;
        read++;
      } catch (e) {
        unreadable++;
        // Ce message finit dans `meta.json` et dans le journal de l'Action, tous deux publics : sans l'identifiant du joueur, ni le curseur de l'API.
        lastFailure = (e instanceof Error ? e.message : String(e)).replaceAll(id, "…").replace(/\?\S*/g, "").slice(0, 300);
        deps.log(`fiche sans réponse lisible : ${lastFailure}`);
      }
    }
  } finally {
    if (changed) await writeMemberGames(deps, players);
  }
  if (unreadable >= MAX_FAILURES_PER_RUN || (read === 0 && unreadable >= OUTAGE_FAILURES)) {
    throw new Error(`${unreadable} fiches sans réponse lisible, ${read} lues, dernière erreur : ${lastFailure}`);
  }
  return { read, left: todo.length - read, unreadable };
}

export interface RunSummary {
  errors: string[];
}

/** Une collecte complète. Un jeu de données en échec garde ses derniers fichiers valides. */
export async function runPipeline(deps: Deps): Promise<RunSummary> {
  await mkdir(join(deps.dataDir, "history"), { recursive: true });
  await mkdir(join(deps.dataDir, "rivals"), { recursive: true });
  const metaPath = join(deps.dataDir, "meta.json");
  const meta = (await readJson(metaPath, Meta)) ?? emptyMeta();
  const api = new ApiClient(deps);
  const at = deps.now().toISOString();
  const errors: string[] = [];
  meta.lastRunAt = at;

  const failed = (label: string, state: DatasetState, e: unknown) => {
    const msg = markError(state, at, e);
    errors.push(`${label} : ${msg}`);
    deps.log(`ÉCHEC ${label} : ${msg}`);
  };

  let leaderboard: StoredLeaderboard | null = null;
  try {
    leaderboard = await fetchLeaderboard(api, deps, at);
    markOk(meta.leaderboard, at);
    deps.log(`classement : ${leaderboard.clans.length} clans`);
  } catch (e) {
    failed("classement", meta.leaderboard, e);
  }

  // Un tag inconnu renvoie 200 avec des zéros : on vérifie avant d'écrire quoi que ce soit.
  let clanExists = false;
  try {
    clanExists = (await api.get(`/clan/${deps.tag}/exists`, ApiClanExists)).exists;
    if (!clanExists) throw new Error(`le tag ${deps.tag} n'existe pas`);
  } catch (e) {
    failed("sessions", meta.sessions, e);
    failed("membres", meta.members, e);
    failed("parties", meta.games, e);
    failed("fiches des membres", meta.memberGames, e);
  }

  if (clanExists) {
    try {
      await fetchSessions(api, deps, meta);
      markOk(meta.sessions, at);
      deps.log(`sessions : couvertes jusqu'au ${meta.sessions.coveredUntil}`);
    } catch (e) {
      failed("sessions", meta.sessions, e);
    }

    try {
      const { read, left, unreadable } = await fetchGames(api, deps);
      // Rien de lu alors qu'il y avait à lire : les données n'ont pas bougé, la date de mise à jour non plus.
      if (read > 0 || unreadable === 0) markOk(meta.games, at);
      deps.log(`parties : ${read} lues, ${left} restent à lire`);
      // Peu nombreux, ces échecs ne sont pas une panne : le site ne l'annonce pas, et son décompte des parties lues reste juste. Le journal de l'Action les garde.
      if (unreadable > 0) errors.push(`parties sans réponse lisible, à relire : ${unreadable}`);
    } catch (e) {
      failed("parties", meta.games, e);
    }

    const lastMembers = meta.members.lastSuccessAt ? Date.parse(meta.members.lastSuccessAt) : 0;
    if (deps.now().getTime() - lastMembers >= MEMBERS_MIN_INTERVAL_MS) {
      try {
        const total = await fetchMembers(api, deps, at);
        markOk(meta.members, at);
        deps.log(`membres : ${total}`);
      } catch (e) {
        failed("membres", meta.members, e);
      }
    }
  }

  let members = await readJson(join(deps.dataDir, "members.json"), StoredMembers);

  if (members) {
    try {
      await forgetFormerMembers(deps, members);
      if (clanExists) {
        members = await dropDeletedMembers(api, deps, members);
        const { read, left, unreadable } = await fetchMemberGames(api, deps, members);
        if (read > 0 || unreadable === 0) markOk(meta.memberGames, at);
        deps.log(`fiches des membres : ${read} lues, ${left} restent à lire`);
        if (unreadable > 0) errors.push(`fiches sans réponse lisible, à relire : ${unreadable}`);
      }
    } catch (e) {
      failed("fiches des membres", meta.memberGames, e);
    }
  }

  // Sans roster, impossible de reconnaître nos joueurs : son absence est déjà signalée.
  if (members) {
    try {
      const found = await fetchRanked(api, deps, at, members);
      markOk(meta.ranked, at);
      deps.log(`classé : ${found} places tenues par des membres`);
    } catch (e) {
      failed("classé", meta.ranked, e);
    }
  }

  if (leaderboard) {
    const me = findClan(withOfficialRanks(leaderboard.clans), deps.tag);
    const date = parisParts(at).date;
    const snapshot: HistorySnapshot = {
      date,
      capturedAt: at,
      leaderboardEnd: leaderboard.end,
      clansListed: leaderboard.clans.length,
      rank: me?.rank ?? null,
      score: me?.weightedWins ?? null,
      games: me?.games ?? null,
      wins: me?.wins ?? null,
      losses: me?.losses ?? null,
      membersTotal: members?.total ?? null,
    };
    await writeJson(join(deps.dataDir, "history", `${date}.json`), snapshot);
    // L'API ne donne pas le passé du classement : ce qui n'est pas relevé aujourd'hui est perdu.
    const rivals: RivalsSnapshot = {
      date,
      capturedAt: at,
      leaderboardEnd: leaderboard.end,
      clans: leaderboard.clans.map((c) => ({ clanTag: c.clanTag, weightedWins: c.weightedWins })),
    };
    await writeJson(join(deps.dataDir, "rivals", `${date}.json`), rivals);
  }

  await writeJson(metaPath, meta);
  return { errors };
}
