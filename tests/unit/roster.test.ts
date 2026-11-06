import { describe, expect, it } from "vitest";
import { fetchRoster, hashPublicId, refreshRoster, type RosterDeps, type RpcResult } from "../../src/lib/compte/roster";

const NOW = new Date("2026-11-06T12:00:00.000Z");

const member = (publicId: string, username: string | null, role = "member") => ({ publicId, username, role, joinedAt: "2026-05-03T00:00:00.000Z" });
const pages = (members: ReturnType<typeof member>[], total = members.length): typeof fetch =>
  (async (url: string | URL | Request) => {
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return Response.json({ results: members.slice((page - 1) * 50, page * 50), total, page, limit: 50 });
  }) as typeof fetch;

function makeDeps(overrides: Partial<RosterDeps> = {}, marks: Record<string, unknown> = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const deps: RosterDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, ...(args ? { args } : {}) });
      const responses: Record<string, RpcResult> = { get_job_marks: { ok: true, ...marks }, sync_clan_roster: { ok: true } };
      return responses[fn] ?? { ok: true };
    },
    fetch: pages([member("PUB-1", "Astra"), member("PUB-2", null)]),
    sleep: async () => {},
    now: () => NOW,
    log: () => {},
    tag: "GAL",
    delayMs: 0,
    ...overrides,
  };
  return { deps, calls };
}

describe("la liste des membres", () => {
  it("ne donne au serveur que l'empreinte du publicId", async () => {
    const { deps, calls } = makeDeps();
    await refreshRoster(deps);
    const sync = calls.find((c) => c.fn === "sync_clan_roster")!;
    expect(sync.args).toEqual({
      p_total: 2,
      p_entries: [
        { hash: hashPublicId("PUB-1"), username: "Astra", role: "member" },
        { hash: hashPublicId("PUB-2"), username: null, role: "member" },
      ],
    });
    expect(JSON.stringify(sync.args)).not.toContain("PUB-");
  });

  it("calcule l'empreinte en SHA-256", () => {
    expect(hashPublicId("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("lit toutes les pages", async () => {
    const many = Array.from({ length: 120 }, (_, i) => member(`PUB-${i}`, `Joueur ${i}`));
    const { entries, total } = await fetchRoster({ fetch: pages(many), sleep: async () => {}, tag: "GAL", delayMs: 0 });
    expect(total).toBe(120);
    expect(entries).toHaveLength(120);
  });

  it("une liste incomplète ne remplace pas la dernière liste valide", async () => {
    const { deps, calls } = makeDeps({ fetch: pages([member("PUB-1", "Astra")], 5) });
    await expect(refreshRoster(deps)).rejects.toThrow(/liste incomplète/);
    expect(calls.some((c) => c.fn === "sync_clan_roster")).toBe(false);
  });

  it("une panne de l'API n'écrit rien", async () => {
    const { deps, calls } = makeDeps({ fetch: (async () => new Response("non", { status: 503 })) as typeof fetch });
    await expect(refreshRoster(deps)).rejects.toThrow(/HTTP 503/);
    expect(calls.some((c) => c.fn === "sync_clan_roster")).toBe(false);
  });

  it("ne relit qu'une fois par jour", async () => {
    let fetched = 0;
    const counting = (async () => ((fetched += 1), Response.json({}))) as typeof fetch;
    const recent = new Date(NOW.getTime() - 3_600_000).toISOString();
    await refreshRoster(makeDeps({ fetch: counting }, { roster_read_at: recent }).deps);
    expect(fetched).toBe(0);

    const old = new Date(NOW.getTime() - 21 * 3_600_000).toISOString();
    const { deps, calls } = makeDeps({}, { roster_read_at: old });
    await refreshRoster(deps);
    expect(calls.some((c) => c.fn === "sync_clan_roster")).toBe(true);
  });

  it("signale un refus du serveur", async () => {
    const { deps } = makeDeps({
      rpc: async (fn) => (fn === "sync_clan_roster" ? { ok: false, error: "roster_incomplete" } : { ok: true }),
    });
    await expect(refreshRoster(deps)).rejects.toThrow(/roster_incomplete/);
  });
});
