/**
 * Contrôle un vrai projet Supabase, sans rien y écrire et sans afficher aucune clé.
 * Lancez : npm run verifier:ligne
 * Avec SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY et, si possible, SUPABASE_SECRET_KEY dans l'environnement.
 */
import { runPreflight } from "../src/lib/conquete/preflight";

const url = process.env["SUPABASE_URL"] ?? "";
const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";

if (!url || !publishableKey) {
  console.error("Il manque SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY. Voir docs/DIRECTION.md.");
  process.exit(2);
}

const checks = await runPreflight({ url, publishableKey, secretKey: process.env["SUPABASE_SECRET_KEY"] });
const MARK = { ok: "OK      ", warn: "À VOIR  ", fail: "ÉCHEC   " } as const;
for (const check of checks) {
  console.log(`${MARK[check.status]}${check.label}`);
  if (check.detail) console.log(`        ${check.detail}`);
}

const failed = checks.filter((c) => c.status === "fail").length;
const warned = checks.filter((c) => c.status === "warn").length;
console.log(failed ? `\n${failed} problème(s) à corriger avant la mise en ligne.` : `\nAucun blocage${warned ? `, ${warned} point(s) à regarder` : ""}.`);
console.log("Ce script ne remplace pas un essai réel : connectez-vous avec Discord sur le site pour finir.");
process.exit(failed ? 1 : 0);
