import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import {
  ApiClanExists,
  ApiLeaderboard,
  ApiMembersPage,
  ApiSessionsPage,
  Meta,
  StoredMembers,
  StoredSessionFile,
  emptyMeta,
  type DatasetState,
  type HistorySnapshot,
  type StoredLeaderboard,
  type StoredSession,
} from "./schemas";
import { toStoredMember } from "./members";
import { mergeSessions } from "./sessions";
import { findClan, withOfficialRanks } from "./stats";
import { addDays, parisParts } from "./time";

export const API_BASE = "https://api.openfront.io/public";
const PAGE_SIZE = 50;
/** Délai après la fin d'un jour UTC avant de le considérer comme définitif. */
const SETTLE_MS = 6 * 3_600_000;
/** Les membres ne sont relus qu'une fois par jour : le fichier est lourd pour Git. */
const MEMBERS_MIN_INTERVAL_MS = 20 * 3_600_000;

export interface Deps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  dataDir: string;
  tag: string;
  archiveStart: string;
  delayMs: number;
  log: (msg: string) => void;
}

export class ApiClient {
  constructor(private deps: Deps) {}

  async get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    const { fetch: f, sleep, delayMs } = this.deps;
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(attempt === 0 ? delayMs : delayMs * 2 ** (attempt + 2));
      let res: Response;
      try {
        res = await f(`${API_BASE}${path}`, { headers: { "User-Agent": "GAL-clan-site/1.0" } });
      } catch (e) {
        lastError = `réseau : ${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${path}`);
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) throw new Error(`réponse invalide sur ${path} : ${parsed.error.message.slice(0, 300)}`);
      return parsed.data;
    }
    throw new Error(`${lastError} sur ${path} après 4 essais`);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, "utf8");
  await rename(tmp, path);
}

async function readJson<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S> | null> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

function markOk(state: DatasetState, at: string): void {
  state.lastSuccessAt = at;
  state.lastError = null;
}
function markError(state: DatasetState, at: string, e: unknown): string {
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

export interface RunSummary {
  errors: string[];
}

/** Une collecte complète. Un jeu de données en échec garde ses derniers fichiers valides. */
export async function runPipeline(deps: Deps): Promise<RunSummary> {
  await mkdir(join(deps.dataDir, "history"), { recursive: true });
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
  }

  if (clanExists) {
    try {
      await fetchSessions(api, deps, meta);
      markOk(meta.sessions, at);
      deps.log(`sessions : couvertes jusqu'au ${meta.sessions.coveredUntil}`);
    } catch (e) {
      failed("sessions", meta.sessions, e);
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

  if (leaderboard) {
    const me = findClan(withOfficialRanks(leaderboard.clans), deps.tag);
    const members = await readJson(join(deps.dataDir, "members.json"), StoredMembers);
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
  }

  await writeJson(metaPath, meta);
  return { errors };
}
