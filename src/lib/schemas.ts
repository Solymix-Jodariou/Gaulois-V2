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

const ApiRankedEntry = z.object({
  rank: z.number().int().positive(),
  public_id: z.string().min(1),
});
/** Une page de `GET /public/leaderboard/ranked` : classement individuel, jamais mêlé aux stats de clan. Elo et victoires ne sont pas lus. */
export const ApiRankedPage = z.object({
  "1v1": z.array(ApiRankedEntry),
  "2v2": z.array(ApiRankedEntry),
  ffa: z.array(ApiRankedEntry),
});
export type ApiRankedPage = z.infer<typeof ApiRankedPage>;
export type RankedMode = keyof ApiRankedPage;

/** D'un joueur, seuls son tag, son identifiant de partie, son équipe et le fait d'avoir des stats sont lus : ni pseudo ni `publicID` n'entrent dans le programme. */
const ApiGamePlayer = z
  .object({
    clientID: z.string().nullable().optional(),
    clanTag: z.string().nullable().optional(),
    // Ajouté au jeu le 3 novembre 2026 (commit a3d8787), pas encore servi par l'API le 7 novembre, donc jamais vu en vrai : seul un texte est gardé.
    team: z.unknown().optional(),
    // Absent : le jeu n'a rien enregistré pour ce joueur, parti tôt ou jamais apparu.
    stats: z.unknown().optional(),
  })
  .transform(({ clientID, clanTag, team, stats }) => ({ clientID: clientID ?? null, clanTag: clanTag ?? null, team: typeof team === "string" ? team : null, hasStats: stats !== undefined && stats !== null }));
/** `GET /public/game/:id?turns=false`. Voir docs/API_AUDIT.md. */
export const ApiGame = z.object({
  info: z.object({
    config: z.object({ gameMap: z.string().min(1) }),
    duration: z.number().nonnegative(),
    // ["team", "Red", ...clientID des vainqueurs]. Absent : la partie n'a pas de vainqueur.
    winner: z.array(z.string()).nullable().optional(),
    players: z.array(ApiGamePlayer),
  }),
});
export type ApiGame = z.output<typeof ApiGame>;

const PlayerGameResult = z.enum(["victory", "defeat", "incomplete"]);
/** Une ligne de `GET /public/player/:id/games`. Le pseudo et l'identifiant de la partie ne sont pas lus. */
const ApiPlayerGame = z.object({
  start: isoDate,
  map: z.string().min(1),
  mode: z.string(),
  type: z.string(),
  rankedType: z.string().nullable().optional(),
  playerTeams: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined ? null : String(v))),
  result: PlayerGameResult,
  clanTag: z.string().nullable().optional(),
});
export type ApiPlayerGame = z.output<typeof ApiPlayerGame>;
export const ApiPlayerGames = z.object({
  results: z.array(ApiPlayerGame),
  nextCursor: z.string().nullable(),
});

/** `GET /public/players/recently-deleted` : OpenFront demande de retirer ces joueurs de ce qui a été collecté. */
export const ApiDeletedPlayers = z.array(z.object({ publicId: z.string().min(1) }));

/* ---------- Carte officielle des clans (voir docs/API_AUDIT.md, section 8) ---------- */

const numericId = z.string().regex(/^\d+$/);
const ApiClanMapClan = z.object({
  tag: z.string().min(1),
  // `null` : le clan n'a pas choisi de couleur.
  color: z.number().int().nullable().optional(),
});

/** Une page de `GET /public/clanmap/history`, la route documentée par OpenFront. */
export const ApiClanMapHistory = z.object({
  // [numéro, x, y, clan, ancien clan, date] : les champs ajoutés plus tard par le jeu sont ignorés.
  events: z.array(z.tuple([numericId, z.number().int().nonnegative(), z.number().int().nonnegative(), numericId, numericId, z.number()], z.unknown())),
  clans: z.record(z.string(), ApiClanMapClan).default({}),
  // `null` : page courte, l'historique s'arrête là pour l'instant.
  next: numericId.nullable(),
});

/** Fiche du clan, hors /public et hors documentation. Le code du jeu précise que son trésor n'est pas réservé aux membres. */
export const ApiClanCard = z.object({
  // Entier décimal en texte. Absent signifie « inconnu », pas zéro.
  softBalance: z.string().regex(/^\d+$/).optional(),
  troops: z.number().nonnegative().optional(),
  memberCount: z.number().int().nonnegative().optional(),
});

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

/** Une partie d'un membre avec pseudo, sous le tag : une ligne de `stats.team`, donc une victoire ou une défaite. Le jour, pas l'heure. */
export const StoredMemberGame = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  map: z.string().min(1),
  teams: z.string().nullable(),
  result: z.enum(["victory", "defeat"]),
});
export type StoredMemberGame = z.infer<typeof StoredMemberGame>;
export const StoredMemberRecent = z.object({
  // Ses parties selon `stats.team` à la lecture : tant que ce nombre ne bouge pas, inutile de relire.
  seen: z.number().int().nonnegative(),
  readOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recent: z.array(StoredMemberGame),
});
export type StoredMemberRecent = z.infer<typeof StoredMemberRecent>;
/** Clé : le `publicId` d'un membre avec pseudo. Un anonyme n'y figure jamais. */
export const StoredMemberGames = z.record(z.string().min(1), StoredMemberRecent);
export type StoredMemberGames = z.infer<typeof StoredMemberGames>;

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

const count = z.number().int().nonnegative();

/** Le classement officiel du jour, dans l'ordre de l'API : le rang est la position dans la liste. */
export const RivalsSnapshot = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capturedAt: isoDate,
  leaderboardEnd: isoDate,
  clans: z.array(z.object({ clanTag: z.string().min(1), weightedWins: z.number() })),
});
export type RivalsSnapshot = z.infer<typeof RivalsSnapshot>;

const StoredRankedMode = z.object({
  // Places lues sur l'API, tenues par des membres ou non. 0 : pas de données, ce n'est pas « aucun membre ».
  listed: count,
  // Membres avec pseudo reconnus sur ces places, et combien dans le haut du classement. Aucun joueur n'est écrit.
  members: count,
  top: count,
});
export const StoredRanked = z.object({
  fetchedAt: isoDate,
  modes: z.object({ "1v1": StoredRankedMode, "2v2": StoredRankedMode, ffa: StoredRankedMode }),
});
export type StoredRanked = z.infer<typeof StoredRanked>;

/** Ce que le site garde d'une partie : des tags et des nombres, aucun joueur. */
export const StoredGame = z.object({
  id: z.string().min(1),
  map: z.string().min(1),
  seconds: count,
  // Numéro de l'équipe gagnante, comparable à celui de `clans`. `null` : impossible de dire qui jouait contre qui.
  win: count.nullable(),
  // [tag, joueurs avec des stats, numéro d'équipe] : le clan du site, et les clans d'au moins 2 de ces joueurs.
  clans: z.array(z.tuple([z.string().min(1), count, count])),
});
export type StoredGame = z.infer<typeof StoredGame>;
export const StoredGameFile = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  games: z.array(StoredGame),
});
export type StoredGameFile = z.infer<typeof StoredGameFile>;

export const StoredClanMapFilm = z.object({
  // 2 : film sans `neutralBorder`, refait au passage suivant de la collecte.
  version: z.union([z.literal(2), z.literal(3)]),
  fetchedAt: isoDate,
  // Numéro du dernier événement lu, et nombre d'événements rejoués.
  seq: count,
  events: count,
  width: count,
  height: count,
  scale: count,
  cols: count,
  rows: count,
  bucket: count,
  totalChanges: count,
  // Pixels de terre de la carte, d'après son manifeste public : voir OFFICIAL_MAP.
  land: count,
  claimed: count,
  // Événements dont l'ancien propriétaire annoncé diffère du rejeu.
  check: z.object({ events: count, mismatches: count }),
  // L'index 0 est la terre neutre. `tag: null` : clan supprimé depuis.
  clans: z.array(z.object({ tag: z.string().nullable(), color: z.number().int().nullable() })),
  // `gal: null` : GAL n'a jamais eu de pixel sur la carte.
  gal: count.nullable(),
  galSummary: z
    .object({
      pixels: count,
      rank: count.nullable(),
      firstEvent: count,
      peak: z.object({ pixels: count, event: count }),
      taken: count,
      lost: count,
      neutralTaken: count,
      fronts: z.array(
        z.object({
          tag: z.string().nullable(),
          // Index du clan dans `clans`, pour le mettre en évidence sur la carte.
          clan: count,
          taken: count,
          lost: count,
          // Pixels de ce clan au contact de GAL, et centre de cette frontière. 0 et `null` : plus de contact.
          border: count,
          at: z.tuple([count, count]).nullable(),
        }),
      ),
      zones: z.array(z.object({ pixels: count, x: count, y: count, halfWidth: count, halfHeight: count })),
      zoneCount: count,
      // Pixels de terre neutre au contact de GAL. `null` : terrain indisponible, ce n'est pas un zéro.
      neutralBorder: count.nullable().default(null),
    })
    .nullable(),
  // Tous les clans présents, dans l'ordre de la carte officielle.
  standings: z.array(z.object({ tag: z.string().nullable(), color: z.number().int().nullable(), pixels: count })),
  // Réserves publiques de GAL à la collecte. `null` : pas de données, ce n'est pas un zéro.
  treasury: z.object({ caps: count.nullable(), troops: z.number().nonnegative().nullable(), members: count.nullable() }).nullable(),
  frames: z.array(
    z.object({
      ev: count,
      total: count,
      clans: count,
      gal: count,
      rank: count.nullable(),
      top: z.array(z.tuple([count, count])),
      cam: z.tuple([count, count, count, count]).nullable(),
    }),
  ),
});
export type StoredClanMapFilm = z.infer<typeof StoredClanMapFilm>;

/** Un relevé par jour, en heure de Paris. */
export const ClanMapJournal = z.array(
  z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pixels: count,
    rank: count.nullable(),
    caps: count.nullable(),
    troops: z.number().nonnegative().nullable(),
  }),
);
export type ClanMapJournal = z.infer<typeof ClanMapJournal>;

const DatasetState = z.object({
  lastSuccessAt: isoDate.nullable(),
  lastErrorAt: isoDate.nullable(),
  lastError: z.string().nullable(),
});
export type DatasetState = z.infer<typeof DatasetState>;

const EMPTY_STATE: DatasetState = { lastSuccessAt: null, lastErrorAt: null, lastError: null };

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
  // Valeur par défaut : un meta.json plus ancien reste valide et garde tout son état.
  clanmap: DatasetState.default(EMPTY_STATE),
  ranked: DatasetState.default(EMPTY_STATE),
  games: DatasetState.default(EMPTY_STATE),
  memberGames: DatasetState.default(EMPTY_STATE),
});
export type Meta = z.infer<typeof Meta>;

export function emptyMeta(): Meta {
  return {
    lastRunAt: null,
    leaderboard: { ...EMPTY_STATE },
    members: { ...EMPTY_STATE },
    sessions: { ...EMPTY_STATE, completeThrough: null, coveredUntil: null },
    clanmap: { ...EMPTY_STATE },
    ranked: { ...EMPTY_STATE },
    games: { ...EMPTY_STATE },
    memberGames: { ...EMPTY_STATE },
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
/**
 * Donateurs recopiés à la main par le clan : le jeu réserve ce classement à ses
 * membres et aucune route publique ne le donne. Vide : le site n'affiche aucun nom.
 */
export const MapHeroes = z.object({
  updatedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  donors: z.array(z.object({ player: z.string().min(1), caps: z.number().int().positive() })),
  highlights: z.array(z.object({ title: z.string().min(1), player: z.string().min(1), detail: z.string().optional() })),
});
export type MapHeroes = z.infer<typeof MapHeroes>;
export const Links = z.object({
  tools: z.array(z.object({ name: z.string().min(1), url: z.url(), description: z.string().min(1) })),
});
export type Links = z.infer<typeof Links>;
