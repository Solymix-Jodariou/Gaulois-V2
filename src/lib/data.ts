import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  Announcements,
  Events,
  HistorySnapshot,
  Links,
  Meta,
  StoredLeaderboard,
  StoredMembers,
  StoredSessionFile,
  emptyMeta,
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

export function loadSessions(): StoredSession[] {
  return listJson("data/sessions").flatMap((f) => read(`data/sessions/${f}`, StoredSessionFile)?.sessions ?? []);
}

export function loadHistory(): HistorySnapshot[] {
  return listJson("data/history").flatMap((f) => {
    const snap = read(`data/history/${f}`, HistorySnapshot);
    return snap ? [snap] : [];
  });
}

export const loadAnnouncements = () => read("content/announcements.json", Announcements) ?? [];
export const loadEvents = () => read("content/events.json", Events) ?? [];
export const loadLinks = () => read("content/links.json", Links) ?? { tools: [] };
