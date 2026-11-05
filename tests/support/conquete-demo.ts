/**
 * Une partie de démonstration, pour regarder le jeu sur son PC sans aucun compte :
 *   npx tsx tests/support/conquete-stack.ts --demo
 * Tout ici est fictif, marqué comme tel, et disparaît à l'arrêt. Rien ne part en ligne.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { callRpc } from "./database";

const MAP = JSON.parse(readFileSync("public/conquete/map-v1.json", "utf8")) as { territories: { id: number; name: string; neighbours: number[] }[] };
const CONFIG = readFileSync("config/conquete.json", "utf8");

export const DEMO_ACCOUNTS = ["Fondateur de démo", "Officier de démo", "Membre de démo", "Recrue de démo"];

const providerId = (name: string) => `discord-${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;

export async function seedDemo(pool: pg.Pool): Promise<void> {
  const addUser = async (name: string, role: string, status: string, capsules: number, display = name) => {
    const { rows } = await pool.query<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
      `${providerId(name)}@example.test`,
      JSON.stringify({ provider_id: providerId(name), full_name: name }),
    ]);
    const id = rows[0]!.id;
    await pool.query(
      `update public.profiles set role = $2::text::public.site_role, status = $3::text::public.member_status, display_name = $4, capsules_total = $5, anonymous_donations = $6,
         validated_at = case when $3::text = 'validated' then now() end where user_id = $1`,
      [id, role, status, display, capsules, capsules % 2 === 0],
    );
    if (capsules > 0) {
      await pool.query(
        "insert into public.donations (user_id, capsules, donated_on, kind, status, created_by, reviewed_by, reviewed_at, note) values ($1, $2, current_date - 3, 'donation', 'approved', $1, $1, now(), 'Don fictif de démonstration')",
        [id, capsules],
      );
    }
    return id;
  };

  const founder = await addUser("Fondateur de démo", "founder", "validated", 12_500);
  const officer = await addUser("Officier de démo", "officer", "validated", 40_001);
  const member = await addUser("Membre de démo", "member", "validated", 1_000);
  const recruit = await addUser("Recrue de démo", "member", "pending", 0);
  const others = await Promise.all(
    [150_000, 0, 5_001, 800, 0, 25_000, 300, 0, 60_001, 2_400].map((capsules, i) => addUser(`Joueur de démo ${i + 1}`, "member", "validated", capsules)),
  );

  // La liste des membres, fictive elle aussi.
  await callRpc(pool, { kind: "service" }, "sync_clan_roster", {
    p_entries: [{ hash: createHash("sha256").update("DEMO-RECRUE").digest("hex"), username: "Recrue de démo", role: "member" }],
    p_total: 1,
  });
  await callRpc(pool, { kind: "user", id: recruit }, "request_membership", { p_claim: "Recrue de démo", p_note: "Je suis sur le vocal ce soir" });
  await callRpc(pool, { kind: "user", id: member }, "declare_donation", { p_request_id: randomUUID(), p_capsules: 750, p_donated_on: new Date().toISOString().slice(0, 10), p_note: "Don fictif à valider" });

  const { rows: seasons } = await pool.query<{ id: string }>(
    "insert into public.seasons (name, status, map_version, config, started_at, war_started_at, created_by) values ('Saison de démonstration', 'war', 'v1', $1::jsonb, now() - interval '6 days', now() - interval '2 days', $2) returning id",
    [CONFIG, founder],
  );
  const season = seasons[0]!.id;

  // Chacun s'étend autour d'une ville, jusqu'à toucher les autres.
  const players = [
    { id: member, seed: "Paris", size: 7 },
    { id: founder, seed: "Berlin", size: 9 },
    { id: officer, seed: "Madrid", size: 8 },
    ...others.map((id, i) => ({ id, seed: ["Moscou", "Le Caire", "Pékin", "Washington", "Tokyo", "Rio de Janeiro", "Delhi", "Sydney", "Johannesbourg", "Mexico"][i]!, size: 6 + (i % 5) * 3 })),
  ];
  const byName = new Map(MAP.territories.map((t) => [t.name, t]));
  const taken = new Set<number>();
  for (const player of players) {
    await pool.query("insert into public.players (season_id, user_id, troops, troops_at, counters_day) values ($1, $2, $3, now(), current_date)", [season, player.id, 60_000]);
    const start = byName.get(player.seed);
    if (!start) throw new Error(`Ville absente de la carte : ${player.seed}`);
    const queue = [start.id];
    let placed = 0;
    while (queue.length > 0 && placed < player.size) {
      const id = queue.shift()!;
      if (taken.has(id)) continue;
      taken.add(id);
      placed++;
      await pool.query("insert into public.territory_state (season_id, territory_id, owner_id, garrison, taken_at) values ($1, $2, $3, $4, now() - interval '2 days')", [season, id, player.id, 800 + ((id * 137) % 9000)]);
      queue.push(...MAP.territories[id - 1]!.neighbours);
    }
  }

  const events = [
    ["season_started", null, null, null],
    ["war_started", null, null, null],
    ["start", member, null, "Paris"],
    ["expand", founder, null, "Berlin"],
    ["attack_lost", others[0]!, founder, "Berlin"],
    ["attack_won", officer, member, "Madrid"],
  ] as const;
  for (const [kind, actor, target, place] of events) {
    await pool.query(
      "insert into public.game_events (season_id, kind, actor_id, target_id, territory_id, sent, losses, garrison_before, garrison_after) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [season, kind, actor, target, place ? byName.get(place)!.id : null, target ? 15_000 : null, target ? 12_869 : null, target ? 10_000 : null, target ? 2131 : null],
    );
  }
}
