import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  Announcements,
  ClanMapJournal,
  Events,
  HistorySnapshot,
  Links,
  MapHeroes,
  Meta,
  RivalsSnapshot,
  StoredClanMapFilm,
  StoredGameFile,
  StoredLeaderboard,
  StoredMemberGames,
  StoredMembers,
  StoredRanked,
  StoredSessionFile,
  emptyMeta,
  type StoredGame,
  type StoredSession,
} from "./schemas";

const root = process.cwd();

/** Lit et valide un fichier. Absent ou invalide : `null`, jamais de valeur inventée. */
function read<S extends z.ZodType>(path: string, schema: S): z.output<S> | null {
  const full = join(root, path);
  if (!existsSync(full)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(full, "utf8")));
    if (parsed.success) return parsed.data;
    console.warn(`Fichier invalide ignoré : ${path}`);
  } catch {
    console.warn(`Fichier illisible ignoré : ${path}`);
  }
  return null;
}

function listJson(dir: string): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export const loadMeta = (): Meta => read("data/meta.json", Meta) ?? emptyMeta();
export const loadLeaderboard = () => read("data/leaderboard.json", StoredLeaderboard);
export const loadMembers = () => read("data/members.json", StoredMembers);
export const loadRanked = () => read("data/ranked.json", StoredRanked);
/** Hors de `data/` et de Git : les lignes de chaque joueur ne doivent pas rester pour toujours dans l'historique public. */
export const MEMBER_GAMES_FILE = ".cache/member-games/players.json";
export const loadMemberGames = () => read(MEMBER_GAMES_FILE, StoredMemberGames) ?? {};
export const loadClanMapFilm = () => read("data/clanmap/film.json", StoredClanMapFilm);
export const loadClanMapJournal = () => read("data/clanmap/journal.json", ClanMapJournal) ?? [];
export const loadMapHeroes = () => read("content/carte-heros.json", MapHeroes) ?? { updatedOn: null, donors: [], highlights: [] };

export function loadSessions(): StoredSession[] {
  return listJson("data/sessions").flatMap((f) => read(`data/sessions/${f}`, StoredSessionFile)?.sessions ?? []);
}

export function loadGames(): StoredGame[] {
  return listJson("data/games").flatMap((f) => read(`data/games/${f}`, StoredGameFile)?.games ?? []);
}

export function loadHistory(): HistorySnapshot[] {
  return listJson("data/history").flatMap((f) => {
    const snap = read(`data/history/${f}`, HistorySnapshot);
    return snap ? [snap] : [];
  });
}

export function loadRivals(): RivalsSnapshot[] {
  return listJson("data/rivals").flatMap((f) => {
    const snap = read(`data/rivals/${f}`, RivalsSnapshot);
    return snap ? [snap] : [];
  });
}

export const loadAnnouncements = () => read("content/announcements.json", Announcements) ?? [];
export const loadEvents = () => read("content/events.json", Events) ?? [];
export const loadLinks = () => read("content/links.json", Links) ?? { tools: [] };
