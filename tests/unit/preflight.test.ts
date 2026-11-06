import { describe, expect, it } from "vitest";
import { runPreflight } from "../../src/lib/compte/preflight";

type Route = { status: number; body?: unknown };

/** Un projet Supabase bien réglé. Chaque test en dérègle une partie. */
const HEALTHY: Record<string, Route> = {
  "/auth/v1/settings": { status: 200, body: { external: { discord: true, email: false } } },
  "/rest/v1/rpc/get_site_news": { status: 200, body: { ok: true } },
  "/rest/v1/rpc/bootstrap_founder": { status: 401, body: {} },
  "/rest/v1/profiles": { status: 401, body: {} },
  "/rest/v1/private_links": { status: 401, body: {} },
  "/rest/v1/admin_log": { status: 401, body: {} },
  "/rest/v1/clan_roster": { status: 401, body: {} },
  "/rest/v1/site_announcements": { status: 401, body: {} },
  "/rest/v1/app_state": { status: 200, body: [{ value: {} }] },
};

const SITE = "https://exemple.supabase.co";
const seen: { url: string; apikey: string | null }[] = [];

const fakeFetch = (routes: Record<string, Route>) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ url: url.href, apikey: headers.get("apikey") });
    // Avec la clé secrète, la table des profils s'ouvre.
    const route = url.pathname === "/rest/v1/profiles" && headers.get("apikey") === "sb_secret_x" ? { status: 200, body: [{ gaul_number: 1 }] } : routes[url.pathname];
    return new Response(JSON.stringify(route?.body ?? {}), { status: route?.status ?? 404 });
  }) as typeof fetch;

const run = (routes: Record<string, Route> = HEALTHY, secretKey?: string) => runPreflight({ url: `${SITE}/`, publishableKey: "sb_publishable_x", secretKey, fetcher: fakeFetch(routes) });
const statusOf = async (routes: Record<string, Route>, label: string) => (await run(routes)).find((c) => c.label.includes(label))?.status;

describe("le contrôle de la mise en ligne", () => {
  it("passe sur un projet bien réglé", async () => {
    const checks = await run(HEALTHY, "sb_secret_x");
    expect(checks.filter((c) => c.status !== "ok")).toEqual([]);
    expect(checks.length).toBeGreaterThan(8);
  });

  it("n'utilise la clé secrète que si on la donne", async () => {
    const checks = await run();
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.at(-1)).toMatchObject({ status: "warn" });
  });

  it("repère une connexion Discord coupée", async () => {
    expect(await statusOf({ ...HEALTHY, "/auth/v1/settings": { status: 200, body: { external: { discord: false } } } }, "Discord")).toBe("fail");
  });

  it("signale l'inscription par e-mail restée active", async () => {
    expect(await statusOf({ ...HEALTHY, "/auth/v1/settings": { status: 200, body: { external: { discord: true, email: true } } } }, "e-mail")).toBe("warn");
  });

  it("repère un schéma absent", async () => {
    expect(await statusOf({ ...HEALTHY, "/rest/v1/rpc/get_site_news": { status: 404 } }, "schéma")).toBe("fail");
  });

  it("bloque si un visiteur peut se désigner fondateur", async () => {
    expect(await statusOf({ ...HEALTHY, "/rest/v1/rpc/bootstrap_founder": { status: 200, body: { ok: false } } }, "fondateur")).toBe("fail");
  });

  it("bloque si un visiteur lit une table privée, mais pas si elle est vide", async () => {
    expect(await statusOf({ ...HEALTHY, "/rest/v1/private_links": { status: 200, body: [{ discord_id: "1" }] } }, "private_links")).toBe("fail");
    expect(await statusOf({ ...HEALTHY, "/rest/v1/private_links": { status: 200, body: [] } }, "private_links")).toBe("ok");
  });

  it("s'arrête net si la clé publique est une clé secrète, sans rien envoyer", async () => {
    seen.length = 0;
    const checks = await runPreflight({ url: SITE, publishableKey: "sb_secret_oups", fetcher: fakeFetch(HEALTHY) });
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("fail");
    expect(seen).toEqual([]);
  });

  it("dit clairement quand le projet ne répond pas", async () => {
    const down = (async () => {
      throw new Error("réseau");
    }) as unknown as typeof fetch;
    const checks = await runPreflight({ url: SITE, publishableKey: "sb_publishable_x", fetcher: down });
    expect(checks).toEqual([expect.objectContaining({ status: "fail" })]);
  });

  it("n'écrit jamais une clé dans ses messages", async () => {
    const checks = await run({ ...HEALTHY, "/rest/v1/profiles": { status: 500 } }, "sb_secret_x");
    expect(JSON.stringify(checks)).not.toContain("sb_secret_x");
    expect(JSON.stringify(checks)).not.toContain("sb_publishable_x");
  });
});
