/**
 * La tâche planifiée du jeu, lancée par la GitHub Action avec la clé secrète de Supabase :
 * relire la liste des membres, effacer les captures, annoncer les événements, sauvegarder.
 * Le jeu lui-même n'en dépend pas : si elle s'arrête, on continue de jouer.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { ApiMembersPage } from "../schemas";

const API = "https://api.openfront.io/public";
const PAGE_SIZE = 50;
const USER_AGENT = "GAL-clan-site/1.0";
/** La liste et la sauvegarde ne se refont qu'une fois par jour : l'Action tourne toutes les heures. */
const DAILY_MS = 20 * 3_600_000;
const DISCORD_LIMIT = 1900;

export type RpcResult = { ok?: boolean; error?: string } & Record<string, unknown>;

export interface JobDeps {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;
  removeFiles: (paths: string[]) => Promise<void>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  log: (message: string) => void;
  writeBackup: (name: string, content: Buffer) => Promise<void>;
  tag: string;
  passphrase: string | null;
  webhook: string | null;
  delayMs: number;
}

export const hashPublicId = (id: string): string => createHash("sha256").update(id, "utf8").digest("hex");

/** Lit toute la liste officielle. Le publicId est aussitôt remplacé par son empreinte. */
export async function fetchRoster(deps: Pick<JobDeps, "fetch" | "sleep" | "tag" | "delayMs">): Promise<{ entries: { hash: string; username: string | null; role: string }[]; total: number }> {
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

/* ---------- La sauvegarde : AES-256-GCM, avec une clé tirée de la phrase secrète ---------- */

const MAGIC = Buffer.from("GALSAVE1");

export function encryptBackup(data: unknown, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(data))), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(file: Buffer, passphrase: string): unknown {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Ce fichier n'est pas une sauvegarde du jeu.");
  let at = MAGIC.length;
  const salt = file.subarray(at, (at += 16));
  const iv = file.subarray(at, (at += 12));
  const tag = file.subarray(at, (at += 16));
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(file.subarray(at)), decipher.final()])).toString("utf8"));
}

/* ---------- Les annonces sur Discord ---------- */

export interface NotifyEvent {
  id: number;
  kind: string;
  actor: string | null;
  target: string | null;
  territory: string | null;
  season: string;
}

export function announcement(e: NotifyEvent): string {
  switch (e.kind) {
    case "season_started":
      return `La saison « ${e.season} » de la Conquête des Gaulois commence : à vos terres !`;
    case "war_started":
      return `La guerre commence dans la saison « ${e.season} » !`;
    case "season_closed":
      return `La saison « ${e.season} » est terminée : le classement et la carte sont figés.`;
    case "attack_won":
      return `${e.actor ?? "Un ancien membre"} a pris ${e.territory ?? "un territoire"} à ${e.target ?? "un ancien membre"}.`;
    default:
      return "";
  }
}

/** Regroupe les annonces en messages que Discord accepte. */
export function batchMessages(lines: string[], limit = DISCORD_LIMIT): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > limit) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) out.push(current);
  return out;
}

const isOld = (at: unknown, now: Date) => typeof at !== "string" || now.getTime() - Date.parse(at) > DAILY_MS;

/** Chaque étape est indépendante : une panne n'empêche pas les suivantes. Renvoie les erreurs. */
export async function runConquestJob(deps: JobDeps): Promise<string[]> {
  const errors: string[] = [];
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      const message = `${name} : ${e instanceof Error ? e.message : String(e)}`;
      errors.push(message);
      deps.log(`::warning::${message}`);
    }
  };
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const result = await deps.rpc(fn, args);
    if (result.ok === false) throw new Error(`${fn} : ${result.error}`);
    return result;
  };

  const marks = (await call("get_job_marks")) as RpcResult & { roster_read_at?: string; backup_at?: string };

  await step("Liste des membres", async () => {
    if (!isOld(marks.roster_read_at, deps.now())) return;
    const { entries, total } = await fetchRoster(deps);
    await call("sync_clan_roster", { p_entries: entries, p_total: total });
    deps.log(`Liste des membres relue : ${total}.`);
  });

  await step("Effacement des captures", async () => {
    const { paths } = (await call("list_file_cleanup")) as RpcResult & { paths: string[] };
    if (paths.length === 0) return;
    await deps.removeFiles(paths);
    await call("confirm_file_cleanup", { p_paths: paths });
    deps.log(`Captures effacées : ${paths.length}.`);
  });

  await step("Annonces Discord", async () => {
    const webhook = deps.webhook;
    if (!webhook) return;
    const { rows } = (await call("list_events_to_notify", { p_limit: 50 })) as RpcResult & { rows: NotifyEvent[] };
    if (rows.length === 0) return;
    for (const content of batchMessages(rows.map(announcement).filter(Boolean))) {
      // Aucune mention : un pseudo ne doit pas pouvoir appeler tout le serveur.
      const res = await deps.fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      });
      if (!res.ok) throw new Error(`Discord : HTTP ${res.status}`);
    }
    await call("mark_events_notified", { p_ids: rows.map((r) => r.id) });
    deps.log(`Événements annoncés : ${rows.length}.`);
  });

  await step("Sauvegarde", async () => {
    const passphrase = deps.passphrase;
    if (!passphrase) {
      deps.log("Pas de BACKUP_PASSPHRASE : aucune sauvegarde produite.");
      return;
    }
    if (!isOld(marks.backup_at, deps.now())) return;
    const dump = await call("export_all");
    const day = deps.now().toISOString().slice(0, 10);
    await deps.writeBackup(`sauvegarde-${day}.enc`, encryptBackup(dump, passphrase));
    await call("set_job_mark", { p_key: "backup_at" });
    deps.log(`Sauvegarde chiffrée produite pour le ${day}.`);
  });

  return errors;
}
