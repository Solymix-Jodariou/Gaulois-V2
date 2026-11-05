/**
 * Tâche de la Conquête, lancée par la GitHub Action. Aucune étape ne touche au site.
 *   npm run conquete:job
 * Pour relire une sauvegarde :
 *   npm run conquete:job -- --lire fichier.enc > sauvegarde.json
 * (avec BACKUP_PASSPHRASE dans l'environnement)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { clan } from "../config/clan";
import { decryptBackup, runConquestJob } from "../src/lib/conquete/job";

const BACKUP_DIR = ".cache/conquete-backup";
const passphrase = process.env["BACKUP_PASSPHRASE"] || null;

const read = process.argv.indexOf("--lire");
if (read !== -1) {
  const file = process.argv[read + 1];
  if (!file || !passphrase) throw new Error("Usage : BACKUP_PASSPHRASE=… npm run conquete:job -- --lire fichier.enc");
  process.stdout.write(`${JSON.stringify(decryptBackup(readFileSync(file), passphrase), null, 2)}\n`);
  process.exit(0);
}

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SECRET_KEY"];
if (!url || !key) {
  console.log("Pas de SUPABASE_URL ou de SUPABASE_SECRET_KEY : le jeu n'est pas en ligne, rien à faire.");
  process.exit(0);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const errors = await runConquestJob({
  rpc: async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args ?? {});
    if (error) throw new Error(`${fn} : ${error.message}`);
    return data as Record<string, unknown>;
  },
  removeFiles: async (paths) => {
    const { error } = await sb.storage.from("donation-proofs").remove(paths);
    if (error) throw new Error(error.message);
  },
  fetch,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  log: console.log,
  writeBackup: async (name, content) => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(join(BACKUP_DIR, name), content);
  },
  tag: clan.tag,
  passphrase,
  webhook: process.env["DISCORD_WEBHOOK_URL"] || null,
  delayMs: 300,
});

if (errors.length > 0) process.exitCode = 1;
