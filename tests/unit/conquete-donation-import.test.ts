import { describe, expect, it } from "vitest";
import { readDonationPages } from "../../src/lib/conquete/donation-import";
import { hashPublicId } from "../../src/lib/conquete/job";
import { fmtRanges } from "../../src/lib/format";

// Tout est fictif : les vraies réponses ne sont visibles que des membres et n'entrent pas dans ce dépôt.
const donation = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: String(id),
  currencyType: "soft",
  amount: "100",
  reason: "clan_donation",
  note: null,
  createdBy: `PUB-${id % 7}`,
  createdByUsername: id % 3 === 0 ? null : `Joueur ${id % 7}`,
  createdAt: "2026-01-15T10:00:00.000Z",
  ...overrides,
});

/** Une page d'un historique de `total` dons, du plus récent au plus ancien, comme la vraie route. */
const page = (n: number, total = 30, limit = 10, rows?: ReturnType<typeof donation>[]) => ({
  results: rows ?? Array.from({ length: Math.min(limit, total - (n - 1) * limit) }, (_, i) => donation(1000 - (n - 1) * limit - i)),
  total,
  page: n,
  limit,
});
const pretty = (value: unknown) => JSON.stringify(value, null, 4);
const idsOf = (rows: { id: string }[]) => rows.map((r) => Number(r.id)).sort((a, b) => b - a);
const idsOfPages = (...pages: { results: { id: string }[] }[]) => idsOf(pages.flatMap((p) => p.results));

describe("fmtRanges", () => {
  it("regroupe les pages qui se suivent", () => {
    expect(fmtRanges([])).toBe("");
    expect(fmtRanges([2])).toBe("2");
    expect(fmtRanges([2, 3, 4, 7, 9, 10])).toBe("2 à 4, 7, 9 à 10");
  });
});

describe("readDonationPages", () => {
  it("lit 20 pages de 10 dons collées dans le désordre", async () => {
    const order = [9, 8, 7, 6, 5, 4, 3, 20, 2, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 1];
    const result = await readDonationPages(order.map((n) => pretty(page(n, 200))).join("\n"));
    expect(result.problems).toEqual([]);
    expect(idsOf(result.rows)).toEqual(Array.from({ length: 200 }, (_, i) => 1000 - i));
    expect(result).toMatchObject({ pages: 20, read: 200, announced: 200, expected: 200, duplicates: 0, missingPages: [], complete: true });
  });

  it("lit une seule page, comme plusieurs", async () => {
    const result = await readDonationPages(pretty(page(1, 10)));
    expect(result).toMatchObject({ read: 10, announced: 10, problems: [], missingPages: [] });
  });

  it.each([
    ["sans rien entre les pages", (a: string, b: string) => a + b],
    ["séparées par une virgule et un retour Windows", (a: string, b: string) => `${a},\r\n${b}`],
    ["dans un tableau", (a: string, b: string) => `[${a}, ${b}]`],
    ["avec une marque d'ordre d'octets en tête", (a: string, b: string) => `﻿${a} ${b}`],
  ])("découpe les pages %s", async (_label, join) => {
    const result = await readDonationPages(join(JSON.stringify(page(1, 20)), JSON.stringify(page(2, 20))));
    expect(result).toMatchObject({ read: 20, problems: [], missingPages: [] });
  });

  it("ne garde qu'une fois un don lu plusieurs fois", async () => {
    const result = await readDonationPages([page(1), page(2), page(1), page(3)].map((p) => pretty(p)).join("\n"));
    expect(result.rows).toHaveLength(30);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(30);
    expect(result).toMatchObject({ read: 30, announced: 30, duplicates: 10, problems: [], missingPages: [] });
  });

  it("une page coupée à la fin n'empêche pas de lire les autres, et se retrouve à recoller", async () => {
    const result = await readDonationPages([pretty(page(1)), pretty(page(2)).slice(0, 300), pretty(page(3))].join("\n"));
    expect(idsOf(result.rows)).toEqual(idsOfPages(page(1), page(3)));
    expect(result.problems).toEqual([{ position: 2, page: null, reason: expect.stringContaining("coupée") }]);
    expect(result).toMatchObject({ pages: 2, missingPages: [2], complete: false });
  });

  it("une page coupée au milieu d'un texte, sans retour à la ligne, n'emporte pas la suivante", async () => {
    const whole = JSON.stringify(page(1));
    const cut = whole.slice(0, whole.indexOf('"createdBy":"') + 15);
    const result = await readDonationPages(cut + JSON.stringify(page(2)) + JSON.stringify(page(3)));
    expect(idsOf(result.rows)).toEqual(idsOfPages(page(2), page(3)));
    expect(result.problems).toEqual([{ position: 1, page: null, reason: expect.stringContaining("coupée") }]);
    expect(result.missingPages).toEqual([1]);
  });

  it("une page amputée de son début donne son numéro, et aucun don de ce morceau n'est gardé", async () => {
    const result = await readDonationPages([pretty(page(1)), pretty(page(2)).slice(200), pretty(page(3))].join("\n"));
    expect(idsOf(result.rows)).toEqual(idsOfPages(page(1), page(3)));
    expect(result.problems).toEqual([{ position: 2, page: 2, reason: expect.stringContaining("pas une réponse JSON") }]);
  });

  it("une coupure pile au début d'un don ne garde rien de ce morceau non plus", async () => {
    const text = pretty(page(2));
    const secondDonation = text.indexOf("{", text.indexOf("{", 1) + 1);
    const result = await readDonationPages([pretty(page(1)), text.slice(secondDonation), pretty(page(3))].join("\n"));
    expect(idsOf(result.rows)).toEqual(idsOfPages(page(1), page(3)));
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.missingPages).toEqual([2]);
  });

  it("signale une réponse qui n'est pas une page de dons", async () => {
    const result = await readDonationPages([pretty(page(1, 10)), '{"error":"Unauthorized"}', '{"results":[{"username":"Joueur"}],"total":1,"page":4,"limit":10}'].join("\n"));
    expect(result.rows).toHaveLength(10);
    expect(result.problems).toEqual([
      { position: 2, page: null, reason: expect.stringContaining("pas une page de dons") },
      { position: 3, page: 4, reason: expect.stringContaining("pas une page de dons") },
    ]);
  });

  it.each([
    ["un montant illisible", { amount: "beaucoup" }, "format inattendu"],
    ["un montant nul", { amount: "0" }, "montant impossible"],
    ["un montant que la base refuserait", { amount: "1000000001" }, "montant impossible"],
    ["une date illisible", { createdAt: "hier" }, "format inattendu"],
  ])("refuse toute une page à cause d'un don avec %s, en gardant les autres pages", async (_label, overrides, reason) => {
    const bad = page(2, 30, 10, [...page(2).results.slice(0, 9), donation(981, overrides)]);
    const result = await readDonationPages([pretty(page(1)), pretty(bad), pretty(page(3))].join("\n"));
    expect(idsOf(result.rows)).toEqual(idsOfPages(page(1), page(3)));
    expect(result.problems).toEqual([{ position: 2, page: 2, reason: expect.stringContaining(reason) }]);
    expect(result.missingPages).toEqual([2]);
  });

  it("signale le texte autour des pages sans perdre les pages", async () => {
    const result = await readDonationPages(`Page 1 :\n${pretty(page(1, 10))}`);
    expect(result.rows).toHaveLength(10);
    expect(result.problems).toEqual([{ position: 1, page: null, reason: expect.stringContaining("pas une réponse JSON") }]);
    // Rien ne manque : ce texte n'empêche pas de dire que la liste est complète.
    expect(result.complete).toBe(true);
  });

  it("une page recollée après avoir été coupée rend la liste complète", async () => {
    const result = await readDonationPages([pretty(page(1)), pretty(page(2)).slice(0, 300), pretty(page(3)), pretty(page(2))].join("\n"));
    expect(result.problems).toHaveLength(1);
    expect(result).toMatchObject({ read: 30, missingPages: [], complete: true });
  });

  it("n'est pas trompée par des accolades, guillemets ou faux débuts de page dans les textes", async () => {
    const rows = [donation(1, { createdByUsername: 'a}"]{b\\' }), donation(2, { note: '{"results":[' }), donation(3, { note: '"page": 99, \\' })];
    const result = await readDonationPages(`${pretty(page(1, 3, 10, rows))}\n${JSON.stringify(page(1, 3, 10, rows))}`);
    expect(result).toMatchObject({ read: 3, duplicates: 3, problems: [], missingPages: [] });
  });

  it("ne garde que les capsules, mais compte le Plutonium comme lu", async () => {
    const result = await readDonationPages(pretty(page(1, 2, 10, [donation(2), donation(1, { currencyType: "hard", amount: "5000000000" })])));
    expect(result.rows.map((r) => r.id)).toEqual(["2"]);
    expect(result).toMatchObject({ read: 2, announced: 2, expected: 1, problems: [], complete: true });
  });

  it("du donneur ne garde qu'une empreinte : ni identifiant, ni pseudo", async () => {
    const rows = [donation(2, { createdBy: "PUB-A", createdByUsername: "Joueur A", amount: "250" }), donation(1, { createdBy: null, createdByUsername: null })];
    const result = await readDonationPages(pretty(page(1, 2, 10, rows)));
    expect(result.rows).toEqual([
      { id: "2", hash: hashPublicId("PUB-A"), capsules: 250, at: "2026-01-15T10:00:00.000Z" },
      { id: "1", hash: null, capsules: 100, at: "2026-01-15T10:00:00.000Z" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/PUB-A|Joueur A|clan_donation/);
  });

  it("montre l'écart quand un décalage entre deux copies perd un don : toutes les pages sont là, pas tous les dons", async () => {
    const shifted = page(2, 20, 10, [donation(991), ...page(2, 20).results.slice(0, 9)]);
    const result = await readDonationPages([pretty(page(1, 20)), pretty(shifted)].join("\n"));
    expect(result).toMatchObject({ read: 19, announced: 20, duplicates: 1, problems: [], missingPages: [], complete: false });
  });

  it("prend le plus grand total annoncé quand un don arrive entre deux copies", async () => {
    const result = await readDonationPages([pretty(page(1, 20)), pretty(page(2, 21))].join("\n"));
    expect(result).toMatchObject({ read: 20, announced: 21, problems: [], missingPages: [3] });
  });

  it("ne liste pas de pages manquantes quand les pages n'ont pas la même taille", async () => {
    const result = await readDonationPages([pretty(page(1, 60, 10)), pretty(page(2, 60, 50))].join("\n"));
    expect(result.problems).toEqual([]);
    expect(result.missingPages).toEqual([]);
    expect(result.announced).toBe(60);
  });

  it("ne trouve rien dans un collage vide", async () => {
    expect(await readDonationPages(" \n ")).toEqual({ rows: [], pages: 0, read: 0, duplicates: 0, problems: [], announced: null, expected: null, missingPages: [], complete: false });
  });
});
