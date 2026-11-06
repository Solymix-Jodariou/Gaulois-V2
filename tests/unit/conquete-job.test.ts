import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { announcement, batchMessages, decryptBackup, encryptBackup, fetchDonations, fetchRoster, hashPublicId, runConquestJob, type JobDeps, type NotifyEvent, type RpcResult } from "../../src/lib/conquete/job";

const NOW = new Date("2026-11-06T12:00:00.000Z");

const member = (publicId: string, username: string | null, role = "member") => ({ publicId, username, role, joinedAt: "2026-05-03T00:00:00.000Z" });
const pages = (members: ReturnType<typeof member>[], total = members.length): typeof fetch =>
  (async (url: string | URL | Request) => {
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return Response.json({ results: members.slice((page - 1) * 50, page * 50), total, page, limit: 50 });
  }) as typeof fetch;

function makeDeps(overrides: Partial<JobDeps> = {}, marks: Record<string, unknown> = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const backups: { name: string; content: Buffer }[] = [];
  const removed: string[][] = [];
  const logs: string[] = [];
  const deps: JobDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, ...(args ? { args } : {}) });
      const responses: Record<string, RpcResult> = {
        get_job_marks: { ok: true, ...marks },
        sync_clan_roster: { ok: true },
        list_file_cleanup: { ok: true, paths: [] },
        confirm_file_cleanup: { ok: true },
        list_events_to_notify: { ok: true, rows: [] },
        mark_events_notified: { ok: true },
        export_all: { ok: true, profiles: [{ name: "Astra" }] },
        set_job_mark: { ok: true },
      };
      return responses[fn] ?? { ok: true };
    },
    removeFiles: async (paths) => {
      removed.push(paths);
    },
    fetch: pages([member("PUB-1", "Astra"), member("PUB-2", null)]),
    sleep: async () => {},
    now: () => NOW,
    log: (m) => logs.push(m),
    writeBackup: async (name, content) => {
      backups.push({ name, content });
    },
    tag: "GAL",
    passphrase: "phrase-de-test",
    webhook: null,
    delayMs: 0,
    donationsKey: null,
    ...overrides,
  };
  return { deps, calls, backups, removed, logs };
}

const donation = (id: number, createdBy: string | null, amount: number, createdAt = "2026-11-06T10:00:00.000Z", currencyType = "soft") => ({
  id: String(id),
  currencyType,
  amount: String(amount),
  reason: "player_donation",
  note: null,
  createdBy,
  createdByUsername: createdBy ? `Pseudo-${createdBy}` : null,
  createdAt,
});

/** L'API des dons : du plus récent au plus ancien, 50 par page. Refuse sans clé. */
function donationsApi(rows: ReturnType<typeof donation>[], requests: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    requests.push(u.toString());
    if (!u.pathname.endsWith("/donations")) return Response.json({ results: [], total: 0, page: 1, limit: 50 });
    if (new Headers(init?.headers).get("Authorization") !== "Bearer cle-donnee-par-openfront") return new Response("non", { status: 401 });
    const page = Number(u.searchParams.get("page"));
    return Response.json({ results: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, limit: 50 });
  }) as typeof fetch;
}

describe("les annonces et le serveur", () => {
  const sql = readFileSync("supabase/migrations/20261105000600_saisons_et_classements.sql", "utf8");
  const listed = /e\.notified_at is null and e\.kind in \(([^)]*)\)/.exec(sql)![1]!.match(/'([a-z_]+)'/g)!.map((s) => s.replaceAll("'", ""));
  const kinds = ["season_started", "war_started", "season_closed", "start", "expand", "attack_won", "attack_lost", "player_excluded", "donation", "donation_cancelled", "building", "bomb", "bomb_intercepted", "alliance_made", "alliance_broken", "victory"];
  const event = (kind: string): NotifyEvent => ({ id: 1, kind, actor: "Astra", target: "Brenn", territory: "Paris", season: "Saison 1", capsules: 2, sent: 200 });

  it("tout ce que le serveur liste a un texte", () => {
    for (const kind of listed) expect(announcement(event(kind)), kind).not.toBe("");
  });

  it("tout ce qui a un texte est bien listé par le serveur : rien n'est rédigé pour rien", () => {
    expect(kinds.filter((kind) => announcement(event(kind)) !== "").sort()).toEqual([...listed].sort());
  });

  it("accorde les mots au nombre", () => {
    expect(announcement({ ...event("donation"), capsules: 1, sent: 1 })).toBe("Astra offre 1 capsule au clan : +1 troupe dans la Conquête.");
    expect(announcement({ ...event("donation"), actor: null })).toContain("Un membre anonyme offre 2 capsules");
  });
});

describe("les dons lus chez OpenFront", () => {
  const key = "cle-donnee-par-openfront";
  const rosterIsFresh = { roster_read_at: NOW.toISOString(), backup_at: NOW.toISOString() };

  it("sans clé donnée par OpenFront, rien n'est lu ni envoyé", async () => {
    const requests: string[] = [];
    const { deps, calls } = makeDeps({ fetch: donationsApi([], requests) }, rosterIsFresh);
    expect(await runConquestJob(deps)).toEqual([]);
    expect(requests).toEqual([]);
    expect(calls.map((c) => c.fn)).not.toContain("ingest_openfront_donations");
  });

  it("n'envoie qu'une empreinte du donneur : ni identifiant, ni pseudo", async () => {
    const { deps, calls } = makeDeps({ fetch: donationsApi([donation(2, "PUB-1", 250), donation(1, null, 10)]), donationsKey: key }, rosterIsFresh);
    expect(await runConquestJob(deps)).toEqual([]);
    const sent = calls.find((c) => c.fn === "ingest_openfront_donations")!;
    expect(sent.args!["p_rows"]).toEqual([
      { id: "2", hash: hashPublicId("PUB-1"), capsules: 250, at: "2026-11-06T10:00:00.000Z" },
      { id: "1", hash: null, capsules: 10, at: "2026-11-06T10:00:00.000Z" },
    ]);
    expect(JSON.stringify(sent.args)).not.toContain("PUB-");
    expect(JSON.stringify(sent.args)).not.toContain("Pseudo");
  });

  it("ne garde que les capsules : le Plutonium ne compte jamais", async () => {
    const rows = await fetchDonations(makeDeps({ fetch: donationsApi([donation(2, "PUB-1", 250), donation(1, "PUB-1", 999, undefined, "hard")]) }).deps, key, null);
    expect(rows.map((r) => r.capsules)).toEqual([250]);
  });

  it("lit toute l'histoire la première fois, puis s'arrête à ce qu'elle connaît déjà", async () => {
    const old = Array.from({ length: 120 }, (_, i) => donation(1000 - i, "PUB-1", 1, new Date(Date.parse("2026-11-06T10:00:00.000Z") - i * 86_400_000).toISOString()));
    const first: string[] = [];
    expect(await fetchDonations(makeDeps({ fetch: donationsApi(old, first) }).deps, key, null)).toHaveLength(120);
    expect(first).toHaveLength(3);

    const next: string[] = [];
    // Le dernier don connu date d'hier : la première page suffit.
    const rows = await fetchDonations(makeDeps({ fetch: donationsApi(old, next) }).deps, key, "2026-11-05T10:00:00.000Z");
    expect(next).toHaveLength(1);
    expect(rows).toHaveLength(50);
  });

  it("une panne d'OpenFront ne change rien : le dernier état valide reste", async () => {
    const { deps, calls } = makeDeps({ fetch: (async () => new Response("non", { status: 503 })) as typeof fetch, donationsKey: key }, rosterIsFresh);
    const errors = await runConquestJob(deps);
    expect(errors).toEqual(["Dons d'OpenFront : dons : HTTP 503"]);
    expect(calls.map((c) => c.fn)).not.toContain("ingest_openfront_donations");
  });

  it("une page illisible n'envoie rien du tout, même les pages précédentes", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => donation(1000 - i, "PUB-1", 1));
    let served = 0;
    const flaky = (async () => {
      served++;
      return served === 1 ? Response.json({ results: rows, total: 100, page: 1, limit: 50 }) : Response.json({ results: [{ id: "x" }], total: 100, page: 2, limit: 50 });
    }) as typeof fetch;
    const { deps, calls } = makeDeps({ fetch: flaky, donationsKey: key }, rosterIsFresh);
    expect((await runConquestJob(deps))[0]).toContain("Dons d'OpenFront");
    expect(calls.map((c) => c.fn)).not.toContain("ingest_openfront_donations");
  });
});

describe("la liste des membres", () => {
  it("n'envoie que des empreintes : aucun identifiant ne quitte la tâche", async () => {
    const { deps, calls } = makeDeps();
    expect(await runConquestJob(deps)).toEqual([]);
    const sync = calls.find((c) => c.fn === "sync_clan_roster")!;
    expect(sync.args!["p_total"]).toBe(2);
    expect(JSON.stringify(sync.args)).not.toContain("PUB-");
    expect(sync.args!["p_entries"]).toEqual([
      { hash: hashPublicId("PUB-1"), username: "Astra", role: "member" },
      { hash: hashPublicId("PUB-2"), username: null, role: "member" },
    ]);
  });

  it("l'empreinte est la même que celle du serveur : un SHA-256 en hexadécimal", () => {
    expect(hashPublicId("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("lit toutes les pages", async () => {
    const many = Array.from({ length: 120 }, (_, i) => member(`PUB-${i}`, `Joueur${i}`));
    const { entries, total } = await fetchRoster({ fetch: pages(many), sleep: async () => {}, tag: "GAL", delayMs: 0 });
    expect(total).toBe(120);
    expect(entries).toHaveLength(120);
  });

  it("une liste incomplète ne remplace pas la dernière liste valide", async () => {
    const { deps, calls, logs } = makeDeps({ fetch: pages([member("PUB-1", "Astra")], 5) });
    const errors = await runConquestJob(deps);
    expect(errors[0]).toMatch(/liste incomplète/);
    expect(calls.some((c) => c.fn === "sync_clan_roster")).toBe(false);
    expect(logs.some((l) => l.startsWith("::warning::"))).toBe(true);
  });

  it("ne relit pas la liste plus d'une fois par jour", async () => {
    const recent = new Date(NOW.getTime() - 3_600_000).toISOString();
    let fetched = 0;
    const { deps } = makeDeps({ fetch: (async () => ((fetched += 1), Response.json({}))) as typeof fetch }, { roster_read_at: recent, backup_at: recent });
    await runConquestJob(deps);
    expect(fetched).toBe(0);
  });

  it("une panne de l'API n'empêche pas les autres étapes", async () => {
    const { deps, backups } = makeDeps({ fetch: (async () => new Response("", { status: 500 })) as typeof fetch });
    const errors = await runConquestJob(deps);
    expect(errors).toHaveLength(1);
    expect(backups).toHaveLength(1);
  });
});

describe("l'effacement des captures", () => {
  it("efface les fichiers, puis seulement les retire de la file", async () => {
    const base = makeDeps();
    const rpc = base.deps.rpc;
    base.deps.rpc = async (fn, args) => (fn === "list_file_cleanup" ? (base.calls.push({ fn }), { ok: true, paths: ["u/a.png"] }) : rpc(fn, args));
    await runConquestJob(base.deps);
    expect(base.removed).toEqual([["u/a.png"]]);
    expect(base.calls.find((c) => c.fn === "confirm_file_cleanup")!.args).toEqual({ p_paths: ["u/a.png"] });
  });

  it("si l'effacement échoue, le fichier reste dans la file pour la prochaine fois", async () => {
    const base = makeDeps({
      removeFiles: async () => {
        throw new Error("panne");
      },
    });
    const rpc = base.deps.rpc;
    base.deps.rpc = async (fn, args) => (fn === "list_file_cleanup" ? { ok: true, paths: ["u/a.png"] } : rpc(fn, args));
    const errors = await runConquestJob(base.deps);
    expect(errors[0]).toMatch(/panne/);
    expect(base.calls.some((c) => c.fn === "confirm_file_cleanup")).toBe(false);
  });
});

describe("les annonces sur Discord", () => {
  const events: NotifyEvent[] = [
    { id: 1, kind: "season_started", actor: null, target: null, territory: null, season: "Saison 1" },
    { id: 2, kind: "attack_won", actor: "Astra", target: "Brenn", territory: "Paris", season: "Saison 1" },
    { id: 3, kind: "attack_won", actor: null, target: null, territory: "Lyon", season: "Saison 1" },
  ];

  it("racontent les événements marquants", () => {
    expect(announcement(events[1]!)).toBe("Astra a pris Paris à Brenn.");
    expect(announcement(events[2]!)).toBe("Un ancien membre a pris Lyon à un ancien membre.");
    expect(announcement(events[0]!)).toContain("Saison 1");
  });

  it("ne partent que si un webhook est configuré", async () => {
    const { deps, calls } = makeDeps();
    await runConquestJob(deps);
    expect(calls.some((c) => c.fn === "list_events_to_notify")).toBe(false);
  });

  it("n'autorisent aucune mention, et ne se répètent pas", async () => {
    const sent: { url: string; body: { content: string; allowed_mentions: unknown } }[] = [];
    const roster = pages([member("PUB-1", "Astra")]);
    const base = makeDeps({
      webhook: "https://discord.example/webhook",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("discord.example")) {
          sent.push({ url: String(url), body: JSON.parse(String(init?.body)) as { content: string; allowed_mentions: unknown } });
          return new Response(null, { status: 204 });
        }
        return roster(url, init);
      }) as typeof fetch,
    });
    const rpc = base.deps.rpc;
    base.deps.rpc = async (fn, args) => (fn === "list_events_to_notify" ? { ok: true, rows: events } : rpc(fn, args));
    await runConquestJob(base.deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.allowed_mentions).toEqual({ parse: [] });
    expect(sent[0]!.body.content).toContain("Astra a pris Paris à Brenn.");
    expect(base.calls.find((c) => c.fn === "mark_events_notified")!.args).toEqual({ p_ids: [1, 2, 3] });
  });

  it("si Discord refuse, les événements restent à annoncer", async () => {
    const roster = pages([member("PUB-1", "Astra")]);
    const base = makeDeps({
      webhook: "https://discord.example/webhook",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => (String(url).includes("discord.example") ? new Response("", { status: 429 }) : roster(url, init))) as typeof fetch,
    });
    const rpc = base.deps.rpc;
    base.deps.rpc = async (fn, args) => (fn === "list_events_to_notify" ? { ok: true, rows: events } : rpc(fn, args));
    const errors = await runConquestJob(base.deps);
    expect(errors[0]).toMatch(/Discord/);
    expect(base.calls.some((c) => c.fn === "mark_events_notified")).toBe(false);
  });

  it("découpent les longs messages", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Ligne ${i} ${"x".repeat(80)}`);
    const batches = batchMessages(lines, 500);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length <= 500)).toBe(true);
    expect(batches.join("\n")).toBe(lines.join("\n"));
  });
});

describe("la sauvegarde chiffrée", () => {
  it("se relit avec la bonne phrase, et elle seule", () => {
    const data = { profiles: [{ name: "Astra", capsules: 1000 }], accents: "é€" };
    const file = encryptBackup(data, "bonne-phrase");
    expect(decryptBackup(file, "bonne-phrase")).toEqual(data);
    expect(() => decryptBackup(file, "mauvaise-phrase")).toThrow();
  });

  it("ne laisse rien en clair, et chaque fichier est différent", () => {
    const a = encryptBackup({ name: "Astra" }, "phrase");
    const b = encryptBackup({ name: "Astra" }, "phrase");
    expect(a.toString("latin1")).not.toContain("Astra");
    expect(a.equals(b)).toBe(false);
  });

  it("refuse un fichier abîmé ou étranger", () => {
    const file = encryptBackup({ a: 1 }, "phrase");
    file[file.length - 1]! ^= 0xff;
    expect(() => decryptBackup(file, "phrase")).toThrow();
    expect(() => decryptBackup(Buffer.from("autre chose"), "phrase")).toThrow(/sauvegarde/);
  });

  it("une fois par jour, et rien sans phrase secrète", async () => {
    const ok = makeDeps();
    await runConquestJob(ok.deps);
    expect(ok.backups.map((b) => b.name)).toEqual(["sauvegarde-2026-11-06.enc"]);
    expect(ok.calls.find((c) => c.fn === "set_job_mark")!.args).toEqual({ p_key: "backup_at" });
    expect(decryptBackup(ok.backups[0]!.content, "phrase-de-test")).toMatchObject({ profiles: [{ name: "Astra" }] });

    const recent = makeDeps({}, { backup_at: new Date(NOW.getTime() - 3_600_000).toISOString() });
    await runConquestJob(recent.deps);
    expect(recent.backups).toHaveLength(0);

    const none = makeDeps({ passphrase: null });
    await runConquestJob(none.deps);
    expect(none.backups).toHaveLength(0);
    expect(none.logs.join(" ")).toContain("aucune sauvegarde");
  });
});
