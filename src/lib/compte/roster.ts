/**
 * Relit la liste officielle des membres et la donne au serveur, avec la clé secrète de Supabase.
 * C'est grâce à elle qu'une demande de validation est comparée à la liste, et que l'encadrement noté
 * à l'avance reçoit son rôle : voir docs/DIRECTION.md. Lancé par la GitHub Action.
 */
import { createHash } from "node:crypto";
import { ApiMembersPage } from "../schemas";

const API = "https://api.openfront.io/public";
const PAGE_SIZE = 50;
const USER_AGENT = "GAL-clan-site/1.0";
/** La liste ne se relit qu'une fois par jour : l'Action tourne toutes les heures. */
const DAILY_MS = 20 * 3_600_000;

export type RpcResult = { ok?: boolean; error?: string } & Record<string, unknown>;

export interface RosterDeps {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  log: (message: string) => void;
  tag: string;
  delayMs: number;
}

export const hashPublicId = (id: string): string => createHash("sha256").update(id, "utf8").digest("hex");

/** Lit toute la liste officielle. Le publicId est aussitôt remplacé par son empreinte. */
export async function fetchRoster(deps: Pick<RosterDeps, "fetch" | "sleep" | "tag" | "delayMs">): Promise<{ entries: { hash: string; username: string | null; role: string }[]; total: number }> {
  const byHash = new Map<string, { hash: string; username: string | null; role: string }>();
  let total = 0;
  for (let page = 1; ; page++) {
    await deps.sleep(deps.delayMs);
    const res = await deps.fetch(`${API}/clan/${deps.tag}/members?page=${page}&limit=${PAGE_SIZE}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`liste des membres : HTTP ${res.status}`);
    const data = ApiMembersPage.parse(await res.json());
    total = data.total;
    for (const m of data.results) {
      const hash = hashPublicId(m.publicId);
      byHash.set(hash, { hash, username: m.username ?? null, role: m.role });
    }
    if (data.results.length === 0 || byHash.size >= total) break;
  }
  // Une liste incomplète ne remplace jamais la dernière liste valide.
  if (total === 0 || byHash.size < total) throw new Error(`liste incomplète : ${byHash.size} reçus pour ${total} annoncés`);
  return { entries: [...byHash.values()], total };
}

/** Relit la liste si la dernière lecture a plus de 20 heures. Lève une erreur si le serveur ou l'API refuse. */
export async function refreshRoster(deps: RosterDeps): Promise<void> {
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const result = await deps.rpc(fn, args);
    if (result.ok === false) throw new Error(`${fn} : ${result.error}`);
    return result;
  };
  const marks = await call("get_job_marks");
  const readAt = marks["roster_read_at"];
  if (typeof readAt === "string" && deps.now().getTime() - Date.parse(readAt) <= DAILY_MS) {
    deps.log("Liste des membres déjà relue aujourd'hui.");
    return;
  }
  const { entries, total } = await fetchRoster(deps);
  await call("sync_clan_roster", { p_entries: entries, p_total: total });
  deps.log(`Liste des membres relue : ${total}.`);
}
