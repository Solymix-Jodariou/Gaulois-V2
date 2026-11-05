/**
 * Démarre tout ce qu'il faut au parcours Playwright de la Conquête :
 * un vrai Postgres, le faux Supabase, puis le site construit avec cette adresse.
 * Lancé par playwright.config.ts. S'arrête avec lui.
 */
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import pg from "pg";
import { DEMO_ACCOUNTS, seedDemo, startDemoGifts } from "./conquete-demo";
import { TEMPLATE_DB, connection, startDatabaseServer } from "./database";
import { startFakeSupabase } from "./fake-supabase";

// Réglables : deux dossiers de travail peuvent ainsi lancer leurs tests en même temps.
export const SUPABASE_PORT = Number(process.env["GAL_TEST_SUPABASE_PORT"] ?? 54399);
export const SITE_PORT = Number(process.env["GAL_TEST_SITE_PORT"] ?? 4322);
const OUT_DIR = "dist-conquete";

const database = await startDatabaseServer();
const pool = new pg.Pool({ ...connection(database.port, TEMPLATE_DB), max: 30 });
// `--demo` : une partie fictive déjà en cours, pour regarder le jeu sur son PC, sans aucun compte.
// Des dons fictifs y arrivent tout seuls. `--direct` : comme si OpenFront avait donné un accès.
const demo = process.argv.includes("--demo");
await startFakeSupabase(pool, SUPABASE_PORT, demo ? { accounts: DEMO_ACCOUNTS } : {});
if (demo) startDemoGifts(pool, await seedDemo(pool), process.argv.includes("--direct"));

// Le film et les logos sont produits par `npm run build` : on les refait s'ils manquent.
if (!existsSync("public/generated/carte/film.json")) {
  const assets = spawnSync("npm", ["run", "assets"], { stdio: "inherit", shell: true });
  if (assets.status !== 0) process.exit(1);
}
const build = spawnSync("npx", ["astro", "build", "--outDir", OUT_DIR], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`, PUBLIC_SUPABASE_KEY: "sb_publishable_cle-de-test" },
});
if (build.status !== 0) process.exit(1);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".gz": "application/gzip",
};

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\\])+/, "");
  let file = join(OUT_DIR, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("Page introuvable");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(SITE_PORT, "127.0.0.1", () => console.log(`Site de test : http://127.0.0.1:${SITE_PORT}`));

const stop = () => {
  void database.stop().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
