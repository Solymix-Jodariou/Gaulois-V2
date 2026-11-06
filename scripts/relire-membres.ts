/**
 * Relit la liste des membres pour le serveur de connexion, lancé par la GitHub Action.
 *   npm run membres:relire
 * Avec SUPABASE_URL et SUPABASE_SECRET_KEY dans l'environnement. Sans eux, ne fait rien.
 */
import { createClient } from "@supabase/supabase-js";
import { clan } from "../config/clan";
import { refreshRoster, type RpcResult } from "../src/lib/compte/roster";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SECRET_KEY"];
if (!url || !key) {
  console.log("Pas de SUPABASE_URL ou de SUPABASE_SECRET_KEY : rien à faire.");
  process.exit(0);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  await refreshRoster({
    rpc: async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args ?? {});
      if (error) throw new Error(`${fn} : ${error.message}`);
      return data as RpcResult;
    },
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    log: console.log,
    tag: clan.tag,
    delayMs: 300,
  });
} catch (e) {
  console.log(`::warning::Liste des membres : ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
