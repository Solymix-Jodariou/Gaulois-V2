import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, type ConquestConfig } from "../../src/lib/conquete/rules";
import { TestDb, asUser, type RpcResult } from "./database";

export interface MapFile {
  version: string;
  source: string;
  hexSize: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  land: string;
  routes: { a: number; b: number; wrap?: boolean }[];
  territories: { id: number; x: number; y: number; name: string; terrain: "plains" | "highland" | "mountain"; neighbours: number[] }[];
}

export const MAP = JSON.parse(readFileSync("public/conquete/map-v1.json", "utf8")) as MapFile;

/** Deux territoires voisins d'un même terrain, pour écrire des tests lisibles. */
export function neighbourOf(id: number, terrain?: string): number {
  const t = MAP.territories[id - 1]!;
  const found = t.neighbours.find((n) => !terrain || MAP.territories[n - 1]!.terrain === terrain);
  if (found === undefined) throw new Error(`Pas de voisin pour ${id}`);
  return found;
}

/** Un groupe de territoires de plaine reliés entre eux, loin des bords. */
export function plainsCluster(size: number): number[] {
  for (const start of MAP.territories) {
    if (start.terrain !== "plains") continue;
    const seen = [start.id];
    for (const id of seen) {
      for (const n of MAP.territories[id - 1]!.neighbours) {
        if (MAP.territories[n - 1]!.terrain === "plains" && !seen.includes(n)) seen.push(n);
      }
      if (seen.length >= size) return seen.slice(0, size);
    }
  }
  throw new Error("Pas assez de plaines reliées");
}

export const clone = (c: ConquestConfig = DEFAULT_CONFIG): ConquestConfig => JSON.parse(JSON.stringify(c)) as ConquestConfig;

/** Une saison lancée, créée par un admin dédié. Ferme d'abord celle qui serait restée ouverte. */
export async function openSeason(db: TestDb, config: ConquestConfig = DEFAULT_CONFIG, warStartsAt?: string): Promise<{ id: number; admin: string }> {
  await db.sql("update public.seasons set status = 'closed', closed_at = now() where status <> 'closed'");
  const admin = await db.addMember(`Admin${randomUUID().slice(0, 6)}`, "admin");
  const created = await db.rpc<RpcResult & { id: number }>(asUser(admin), "create_season", { p_name: "Saison de test", p_config: config });
  if (!created.ok) throw new Error(`create_season : ${created.error}`);
  const started = await db.rpc(asUser(admin), "start_season", { p_season: created.id, p_war_starts_at: warStartsAt ?? null });
  if (!started.ok) throw new Error(`start_season : ${started.error}`);
  return { id: created.id, admin };
}

export const rid = () => randomUUID();

export const chooseStart = (db: TestDb, user: string, territory: number, garrison: number) =>
  db.rpc<RpcResult & { troops: number; garrison: number }>(asUser(user), "choose_start", { p_request_id: rid(), p_territory: territory, p_garrison: garrison });
export const expand = (db: TestDb, user: string, territory: number, troops: number) =>
  db.rpc<RpcResult & { cost: number; garrison: number; troops: number }>(asUser(user), "expand", { p_request_id: rid(), p_territory: territory, p_troops: troops });
export const attack = (db: TestDb, user: string, territory: number, troops: number) =>
  db.rpc<RpcResult & { won: boolean; losses: number; garrison_after: number; troops: number }>(asUser(user), "attack", { p_request_id: rid(), p_territory: territory, p_troops: troops });
export const reinforce = (db: TestDb, user: string, territory: number, troops: number) =>
  db.rpc<RpcResult & { garrison: number; troops: number }>(asUser(user), "reinforce", { p_request_id: rid(), p_territory: territory, p_troops: troops });

/** Place directement un joueur sur la carte : pour préparer une situation de guerre sans la jouer. */
export async function place(db: TestDb, season: number, user: string, territory: number, garrison: number, opts: { protectedHours?: number } = {}): Promise<void> {
  await db.sql(
    `insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at, protected_until)
     values ($1, $2, $3, $4, now(), ${opts.protectedHours ? `now() + interval '${opts.protectedHours} hours'` : "null"})`,
    [season, territory, user, garrison],
  );
}

export async function enlist(db: TestDb, season: number, user: string, troops: number): Promise<void> {
  await db.sql(
    `insert into public.players (season_id, user_id, troops, troops_at, counters_day)
     values ($1, $2, $3, now(), (now() at time zone 'Europe/Paris')::date)
     on conflict (season_id, user_id) do update set troops = excluded.troops, troops_at = excluded.troops_at`,
    [season, user, troops],
  );
}

export async function playerRow(db: TestDb, season: number, user: string) {
  const [row] = await db.sql<{ troops: string; expansions_today: number; attacks_today: number; captured: number; lost: number; excluded_at: Date | null }>(
    "select troops, expansions_today, attacks_today, captured, lost, excluded_at from public.players where season_id = $1 and user_id = $2",
    [season, user],
  );
  return row ? { ...row, troops: Number(row.troops) } : undefined;
}

export async function stateRow(db: TestDb, season: number, territory: number) {
  const [row] = await db.sql<{ owner_id: string; garrison: string; protected_until: Date | null }>(
    "select owner_id, garrison, protected_until from public.territory_state where season_id = $1 and territory_id = $2",
    [season, territory],
  );
  return row ? { ...row, garrison: Number(row.garrison) } : undefined;
}

export async function seasonStatus(db: TestDb, season: number): Promise<string> {
  const [row] = await db.sql<{ status: string }>("select status from public.seasons where id = $1", [season]);
  return row!.status;
}
