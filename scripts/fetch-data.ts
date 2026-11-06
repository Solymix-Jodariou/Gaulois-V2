import { existsSync } from "node:fs";
import { clan } from "../config/clan";
import { runClanMap } from "../src/lib/clanmap/collect";
import { runPipeline, type Deps } from "../src/lib/pipeline";

const deps: Deps = {
  fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  dataDir: "data",
  tag: clan.tag,
  archiveStart: clan.archiveStart,
  delayMs: 300,
  log: console.log,
};

// `--carte` : ne met à jour que la carte des clans, sans attendre le délai d'une journée.
const mapOnly = process.argv.includes("--carte");
const errors = mapOnly ? [] : (await runPipeline(deps)).errors;
const cacheDir = ".cache/clanmap";
// Sur GitHub, un cache vide se reconstruit sans attendre : le délai ne ferait que retarder la même relecture.
const emptyCacheOnGitHub = process.env.GITHUB_ACTIONS === "true" && !existsSync(`${cacheDir}/events.bin`);
errors.push(...(await runClanMap({ ...deps, cacheDir, force: mapOnly || emptyCacheOnGitHub })).errors);

// Une panne de l'API n'échoue pas le job : l'état est écrit dans data/meta.json
// et le site le signale. La panne reste visible dans les journaux de l'Action.
for (const e of errors) console.log(`::warning::${e}`);
