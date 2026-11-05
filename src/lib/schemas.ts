import { z } from "zod";

const WL = z.object({ wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative() });
const isoDate = z.iso.datetime();

/* ---------- Réponses de l'API OpenFront ---------- */

export const ApiLeaderboardEntry = z.object({
  clanTag: z.string().min(1),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  playerSessions: z.number().int().nonnegative(),
  weightedWins: z.number(),
  weightedLosses: z.number(),
  weightedWLRatio: z.number(),
});

export const ApiLeaderboard = z.object({
  start: isoDate,
  end: isoDate,
  clans: z.array(ApiLeaderboardEntry).min(1),
});

export const ApiSession = z.object({
  gameId: z.string().min(1),
  clanTag: z.string(),
  clanPlayerCount: z.number().int().nonnegative(),
  hasWon: z.boolean(),
  numTeams: z.number().int().nonnegative(),
  playerTeams: z
    .union([z.string(), z.number()])
    .nullable()
    .transform((v) => (v === null ? null : String(v))),
  totalPlayerCount: z.number().int().nonnegative(),
  gameStart: isoDate,
  score: z.number(),
});

export const ApiSessionsPage = z.object({
  results: z.array(ApiSession),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});

export const ApiMember = z.object({
  role: z.enum(["leader", "officer", "member"]),
  joinedAt: isoDate,
  publicId: z.string().min(1),
  username: z.string().nullable().optional(),
  // Le schéma du jeu rend `stats` optionnel : absent signifie « pas de données ».
  stats: z.object({ team: WL }).optional(),
});

export const ApiMembersPage = z.object({
  results: z.array(ApiMember),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});

export const ApiClanExists = z.object({ exists: z.boolean() });

/* ---------- Fichiers écrits dans data/ ---------- */

export const StoredLeaderboard = ApiLeaderboard.extend({ fetchedAt: isoDate });
export type StoredLeaderboard = z.infer<typeof StoredLeaderboard>;
export type LeaderboardEntry = z.infer<typeof ApiLeaderboardEntry>;

export const StoredSession = z.object({
  gameId: z.string().min(1),
  clanPlayerCount: z.number().int().nonnegative(),
  hasWon: z.boolean(),
  numTeams: z.number().int().nonnegative(),
  playerTeams: z.string().nullable(),
  totalPlayerCount: z.number().int().nonnegative(),
  gameStart: isoDate,
  score: z.number(),
});
export type StoredSession = z.infer<typeof StoredSession>;
export const StoredSessionFile = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  sessions: z.array(StoredSession),
});
export type StoredSessionFile = z.infer<typeof StoredSessionFile>;

export const StoredMember = z.object({
  role: z.enum(["leader", "officer", "member"]),
  joinedAt: isoDate,
  // Uniquement pour les membres avec pseudo. Voir docs/API_AUDIT.md, section 7.
  publicId: z.string().nullable(),
  username: z.string().nullable(),
  // Parties d'équipe sous le tag. `null` : l'API n'a pas fourni de stats.
  team: WL.nullable(),
});
export type StoredMember = z.infer<typeof StoredMember>;
export const StoredMembers = z.object({
  fetchedAt: isoDate,
  total: z.number().int().nonnegative(),
  members: z.array(StoredMember),
});
export type StoredMembers = z.infer<typeof StoredMembers>;

export const HistorySnapshot = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capturedAt: isoDate,
  leaderboardEnd: isoDate,
  clansListed: z.number().int(),
  // `rank: null` : GAL est absent de la liste officielle, ce n'est pas un rang 0.
  rank: z.number().int().positive().nullable(),
  score: z.number().nullable(),
  games: z.number().int().nullable(),
  wins: z.number().int().nullable(),
  losses: z.number().int().nullable(),
  membersTotal: z.number().int().nullable(),
});
export type HistorySnapshot = z.infer<typeof HistorySnapshot>;

const DatasetState = z.object({
  lastSuccessAt: isoDate.nullable(),
  lastErrorAt: isoDate.nullable(),
  lastError: z.string().nullable(),
});
export type DatasetState = z.infer<typeof DatasetState>;

export const Meta = z.object({
  lastRunAt: isoDate.nullable(),
  leaderboard: DatasetState,
  members: DatasetState,
  sessions: DatasetState.extend({
    // Dernier jour UTC considéré comme définitif (plus relu ensuite).
    completeThrough: z.string().nullable(),
    // Instant jusqu'où les sessions sont connues sans trou.
    coveredUntil: isoDate.nullable(),
  }),
});
export type Meta = z.infer<typeof Meta>;

export function emptyMeta(): Meta {
  const empty = { lastSuccessAt: null, lastErrorAt: null, lastError: null };
  return {
    lastRunAt: null,
    leaderboard: { ...empty },
    members: { ...empty },
    sessions: { ...empty, completeThrough: null, coveredUntil: null },
  };
}

/* ---------- Contenus éditables (content/*.json) ---------- */

export const Announcements = z.array(
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1),
    body: z.string().min(1),
    url: z.url().optional(),
  }),
);
export type Announcements = z.infer<typeof Announcements>;
export const Events = z.array(
  z.object({
    start: isoDate,
    title: z.string().min(1),
    description: z.string().optional(),
    url: z.url().optional(),
  }),
);
export type Events = z.infer<typeof Events>;
export const Links = z.object({
  tools: z.array(z.object({ name: z.string().min(1), url: z.url(), description: z.string().min(1) })),
});
export type Links = z.infer<typeof Links>;
