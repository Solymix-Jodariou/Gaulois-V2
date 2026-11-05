import { describe, expect, it } from "vitest";
import { fetchLiveNews, mergeAnnouncements, mergeEvents, safeUrl, toLocalInput } from "../../src/lib/conquete/news";

const NOW = Date.parse("2026-11-06T12:00:00Z");

describe("les annonces", () => {
  it("mêle le dépôt et le direct, les plus récentes d'abord", () => {
    const items = mergeAnnouncements([{ date: "2026-11-01", title: "Dépôt", body: "b" }], [{ id: 1, title: "Direct", body: "b", url: null, created_at: "2026-11-05T10:00:00Z" }]);
    expect(items.map((i) => i.title)).toEqual(["Direct", "Dépôt"]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
  it("écarte un lien dangereux reçu du serveur", () => {
    const [item] = mergeAnnouncements([], [{ id: 1, title: "T", body: "b", url: "javascript:alert(1)", created_at: "2026-11-05T10:00:00Z" }]);
    expect(item?.url).toBeNull();
  });
});

describe("safeUrl", () => {
  it("n'accepte que https, sans espace ni guillemet", () => {
    expect(safeUrl("https://discord.gg/x")).toBe("https://discord.gg/x");
    for (const bad of ["http://a.fr", "javascript:x", "data:text/html,x", "https://a b", 'https://a"b', "", null, undefined]) expect(safeUrl(bad), String(bad)).toBeNull();
  });
});

describe("les événements", () => {
  it("garde ceux à venir, les plus proches d'abord", () => {
    const items = mergeEvents(
      [
        { start: "2026-11-20T20:00:00Z", title: "Loin" },
        { start: "2026-11-01T20:00:00Z", title: "Passé" },
      ],
      [{ id: 1, title: "Proche", description: null, url: null, starts_at: "2026-11-07T20:00:00Z" }],
      NOW,
    );
    expect(items.map((i) => i.title)).toEqual(["Proche", "Loin"]);
  });
});

describe("fetchLiveNews", () => {
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("renvoie les données", async () => {
    expect(await fetchLiveNews(respond(200, { ok: true, announcements: [], events: [] }))).toEqual({ announcements: [], events: [] });
  });
  it("renvoie null en cas de panne ou de réponse inattendue : la page garde le dépôt", async () => {
    expect(await fetchLiveNews(respond(500, {}))).toBeNull();
    expect(await fetchLiveNews(respond(200, { ok: false }))).toBeNull();
    expect(
      await fetchLiveNews((async () => {
        throw new Error("réseau");
      }) as unknown as typeof fetch),
    ).toBeNull();
  });
});

describe("toLocalInput", () => {
  it("écrit la date comme l'attend un champ datetime-local, et revient à la même heure", () => {
    const iso = "2026-11-20T19:30:00.000Z";
    const local = toLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(local).toISOString()).toBe(iso);
  });
});
