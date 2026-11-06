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
/** Les capsules, fictives, des dix autres joueurs. */
const CAPSULES = [150_000, 0, 5_001, 800, 0, 25_000, 300, 0, 60_001, 2_400];

const providerId = (name: string) => `discord-${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
const DEMO_GIFTS = [50, 120, 250, 500, 800, 1000];
export const DEMO_GIFT_EVERY_MS = 20_000;

/**
 * Des dons fictifs qui arrivent pendant qu'on regarde, un toutes les 20 secondes.
 *  - Par défaut, ce qui marche aujourd'hui : un membre déclare, l'officier de démo valide aussitôt.
 *  - Avec `--direct`, ce que donnerait un accès d'OpenFront : les dons arrivent tout seuls.
 */
export function startDemoGifts(pool: pg.Pool, players: DemoPlayers, direct: boolean): () => void {
  let turn = 0;
  let ledger = 1000;
  const readLedger = (rows: { publicId: string; capsules: number; at: string }[]) =>
    callRpc(pool, { kind: "service" }, "ingest_openfront_donations", {
      p_rows: rows.map((r) => ({ id: String(ledger++), hash: createHash("sha256").update(r.publicId).digest("hex"), capsules: r.capsules, at: r.at })),
    });
  const started = direct
    ? // La toute première lecture : l'histoire des dons, qui remplace ce qui avait été validé à la main.
      readLedger(players.donors.filter((d) => d.capsules > 0).map((d) => ({ publicId: d.publicId, capsules: d.capsules, at: new Date(Date.now() - 3 * 86_400_000).toISOString() })))
    : Promise.resolve({});

  const gift = async () => {
    await started;
    const donor = players.donors[turn % 3 === 0 ? 0 : 1 + (turn * 7) % (players.donors.length - 1)]!;
    const capsules = DEMO_GIFTS[turn % DEMO_GIFTS.length]!;
    turn++;
    if (direct) {
      await readLedger([{ publicId: donor.publicId, capsules, at: new Date().toISOString() }]);
      return;
    }
    const declared = await callRpc<{ id: number }>(pool, { kind: "user", id: donor.id }, "declare_donation", { p_request_id: randomUUID(), p_capsules: capsules, p_donated_on: today(), p_note: "Don fictif de démonstration" });
    await callRpc(pool, { kind: "user", id: players.officer }, "review_donation", { p_donation: declared.id, p_approve: true });
  };
  const timer = setInterval(() => {
    gift().catch((e: unknown) => console.warn("Don de démonstration :", e));
  }, DEMO_GIFT_EVERY_MS);
  void gift().catch((e: unknown) => console.warn("Don de démonstration :", e));
  return () => clearInterval(timer);
}

export interface DemoPlayers {
  officer: string;
  /** Tous sauf l'officier qui valide. Le premier est le membre de démo : c'est lui qu'on regarde. */
  donors: { id: string; publicId: string; capsules: number }[];
}

export async function seedDemo(pool: pg.Pool): Promise<DemoPlayers> {
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
    if (status === "validated") {
      // Son identifiant OpenFront fictif, pour que la démo puisse aussi lire ses dons « chez OpenFront ».
      await pool.query("update public.private_links set openfront_hash = $2 where user_id = $1", [id, createHash("sha256").update(`DEMO-${name}`).digest("hex")]);
    }
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
  const others = await Promise.all(CAPSULES.map((capsules, i) => addUser(`Joueur de démo ${i + 1}`, "member", "validated", capsules)));

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
    await pool.query("insert into public.players (season_id, user_id, troops, troops_at, counters_day, gold) values ($1, $2, $3, now(), current_date, $4)", [season, player.id, 60_000, 45_000]);
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

  // De quoi tout voir : des bâtiments sur les villes de départ, une alliance, un traître, une terre tout juste prise.
  const building = (name: string, kind: string) => pool.query("update public.territory_state set building = $3 where season_id = $1 and territory_id = $2", [season, byName.get(name)!.id, kind]);
  await building("Paris", "city");
  await building("Berlin", "post");
  await building("Madrid", "port");
  await building("Moscou", "silo");
  await building("Le Caire", "sam");
  await building("Pékin", "city");
  await building("Tokyo", "port");
  const pair = [member, founder].sort() as [string, string];
  await pool.query("insert into public.alliances (season_id, a, b, requested_by, status, expires_at) values ($1, $2, $3, $4, 'active', now() + interval '36 hours')", [season, pair[0], pair[1], founder]);
  const pending = [member, others[1]!].sort() as [string, string];
  await pool.query("insert into public.alliances (season_id, a, b, requested_by, status, expires_at) values ($1, $2, $3, $4, 'pending', now() + interval '20 hours')", [season, pending[0], pending[1], others[1]]);
  await pool.query("update public.players set traitor_until = now() + interval '20 hours' where season_id = $1 and user_id = $2", [season, others[2]]);
  await pool.query("update public.territory_state set taken_at = now() where season_id = $1 and territory_id = $2", [season, byName.get("Moscou")!.id]);

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

  return {
    officer,
    donors: [
      { id: member, publicId: "DEMO-Membre de démo", capsules: 1_000 },
      { id: founder, publicId: "DEMO-Fondateur de démo", capsules: 12_500 },
      ...others.map((id, i) => ({ id, publicId: `DEMO-Joueur de démo ${i + 1}`, capsules: CAPSULES[i]! })),
    ],
  };
}
