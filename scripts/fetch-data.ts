import { clan } from "../config/clan";
import { runPipeline } from "../src/lib/pipeline";

const { errors } = await runPipeline({
  fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  dataDir: "data",
  tag: clan.tag,
  archiveStart: clan.archiveStart,
  delayMs: 300,
  log: console.log,
});

// Une panne de l'API n'échoue pas le job : l'état est écrit dans data/meta.json
// et le site le signale. La panne reste visible dans les journaux de l'Action.
for (const e of errors) console.log(`::warning::${e}`);
