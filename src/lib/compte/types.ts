export type Role = "member" | "officer" | "admin" | "founder";
export type MemberStatus = "pending" | "validated" | "suspended";
export type RequestStatus = "pending" | "approved" | "refused" | "cancelled";

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
  discord_name?: string | null;
  openfront_username?: string | null;
  linked?: boolean;
  request?: MyRequest | null;
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
  discord_name: string | null;
  openfront_username: string | null;
  in_roster: boolean;
  linked: boolean;
  created_at: string;
  validated_at: string | null;
}

export interface LogRow {
  id: number;
  at: string;
  action: string;
  details: Record<string, unknown>;
  actor: string | null;
  target: string | null;
}
