import type { ConquestConfig, Terrain } from "./rules";

export type Role = "member" | "officer" | "admin" | "founder";
export type MemberStatus = "pending" | "validated" | "suspended";
export type RequestStatus = "pending" | "approved" | "refused" | "cancelled";
export type DonationStatus = "pending" | "approved" | "refused" | "cancelled" | "superseded";
export type Phase = "expansion" | "war";

export const ROLE_LABELS: Record<Role, string> = { member: "Membre", officer: "Officier", admin: "Admin", founder: "Fondateur" };

export interface MyRequest {
  id: number;
  status: RequestStatus;
  reason: string | null;
  in_roster: boolean;
  roster_username: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface Me {
  signed_in: boolean;
  number?: number;
  name?: string;
  role?: Role;
  status?: MemberStatus;
  status_reason?: string | null;
  /** 0 tant que le compte n'est pas validé, puis 1 membre, 2 officier, 3 admin, 4 fondateur. Pour l'affichage seulement. */
  rank?: number;
  anonymous?: boolean;
  capsules?: number;
  discord_name?: string | null;
  openfront_username?: string | null;
  linked?: boolean;
  request?: MyRequest | null;
}

export interface Donation {
  id: number;
  capsules: number;
  donated_on: string;
  kind: "donation" | "opening";
  status: DonationStatus;
  reason: string | null;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  troops_granted: number;
}

/** Vide tant qu'OpenFront n'a pas donné d'accès : les dons sont alors déclarés et validés à la main. */
export interface DonationSync {
  since: string;
  read_at: string;
}

export interface DonorRow {
  rank: number;
  name: string | null;
  total: number;
  season: number | null;
  recent: number;
  me: boolean;
}

export interface MapTerritory {
  id: number;
  x: number;
  y: number;
  name: string;
  terrain: Terrain;
  neighbours: number[];
  /** Le contour dessiné : l'hexagone, arrêté aux côtes. */
  shape: string;
}

export interface GameMap {
  version: string;
  source: string;
  hexKm2: number;
  hexSize: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  land: string;
  routes: { a: number; b: number; wrap?: boolean }[];
  territories: MapTerritory[];
}

export interface Season {
  id: number;
  name: string;
  map_version: string;
  phase: Phase;
  started_at: string | null;
  war_starts_at: string | null;
  war_started_at: string | null;
  config: ConquestConfig;
}

export interface Player {
  number: number;
  name: string;
  territories: number;
  captured: number;
  lost: number;
}

export interface TerritoryState {
  id: number;
  owner: number;
  garrison: number;
  protected_until?: string | null;
}

export interface GameState {
  season: Season | null;
  players?: Player[];
  territories?: TerritoryState[];
  me?: number | null;
  read_at: string;
}

export interface MyGame {
  season: number | null;
  capsules: number;
  in_game?: boolean;
  start_troops?: number;
  excluded?: boolean;
  excluded_reason?: string | null;
  troops?: number;
  capacity?: number;
  territories?: number;
  next_regen?: number;
  next_regen_at?: string;
  expansions_today?: number;
  attacks_today?: number;
  cooldown_until?: string | null;
  captured?: number;
  lost?: number;
}

export type EventKind = "season_started" | "war_started" | "season_closed" | "start" | "expand" | "attack_won" | "attack_lost" | "player_excluded" | "donation" | "donation_cancelled";

export interface FeedRow {
  id: number;
  at: string;
  kind: EventKind;
  sent: number | null;
  losses: number | null;
  garrison_before: number | null;
  garrison_after: number | null;
  /** Pour un don : les capsules données. Les troupes reçues sont dans `sent`. */
  capsules: number | null;
  actor: string | null;
  target: string | null;
  territory: string | null;
  territory_id: number | null;
}

export interface Standing {
  number: number;
  name: string;
  territories: number;
  captured: number;
  lost: number;
  rank_territories: number;
  rank_conquerors: number;
}

export interface HistoryRow {
  id: number;
  name: string;
  started_at: string | null;
  closed_at: string | null;
  map_version: string;
  biggest: Standing | null;
  conqueror: Standing | null;
}

export interface ClosedSeason {
  id: number;
  name: string;
  map_version: string;
  started_at: string | null;
  closed_at: string | null;
  standings: Standing[];
  territories: TerritoryState[];
  donors: { rank: number; name: string | null; total: number }[];
}

export interface RequestRow {
  id: number;
  number: number;
  name: string;
  discord_name: string | null;
  discord_id: string | null;
  in_roster: boolean;
  roster_username: string | null;
  claimed_text: string | null;
  note: string | null;
  status: RequestStatus;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  /** Le rang dans la liste officielle du jeu. Une indication pour l'officier, jamais un droit. */
  game_role: string | null;
}

export interface MemberRow {
  user_id: string;
  number: number;
  name: string;
  role: Role;
  status: MemberStatus;
  status_reason: string | null;
  capsules: number;
  discord_name: string | null;
  openfront_username: string | null;
  in_roster: boolean;
  linked: boolean;
  created_at: string;
  validated_at: string | null;
}

export interface DonationRow {
  id: number;
  number: number;
  name: string;
  capsules: number;
  donated_on: string;
  kind: "donation" | "opening";
  note: string | null;
  screenshot_path: string | null;
  status: DonationStatus;
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  troops_granted: number;
  can_review: boolean;
}

export interface SeasonRow {
  id: number;
  name: string;
  status: "draft" | "expansion" | "war" | "closed";
  map_version: string;
  config: ConquestConfig;
  war_starts_at: string | null;
  started_at: string | null;
  war_started_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface LogRow {
  id: number;
  at: string;
  action: string;
  details: Record<string, unknown>;
  actor: string | null;
  target: string | null;
}

export interface ExcludedRow {
  number: number;
  name: string;
  excluded_at: string;
  excluded_reason: string | null;
}
