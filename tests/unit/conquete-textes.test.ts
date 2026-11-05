import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_LABELS, flattenConfig, withValue } from "../../src/lib/conquete/config-labels";
import { ERROR_MESSAGES, errorMessage } from "../../src/lib/conquete/errors";
import { feedDetail, feedText, playerColor } from "../../src/lib/conquete/feed";
import { DEFAULT_CONFIG, capacity, donationTroops, neutralCost, resolveAttack, settle, startingTroops } from "../../src/lib/conquete/rules";
import type { EventKind, FeedRow } from "../../src/lib/conquete/types";

const SQL = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && !f.includes("carte"))
  .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
  .join("\n");
/** Les nombres français s'écrivent avec une espace fine : on compare sans distinguer les espaces. */
const flat = (s: string) => s.replace(/\s/g, " ");
const RULES = flat(readFileSync("docs/REGLES_CONQUETE.md", "utf8"));
const fr = (n: number) => flat(new Intl.NumberFormat("fr-FR").format(n));

describe("les refus du serveur", () => {
  it("ont tous un message en français", () => {
    const codes = new Set([...SQL.matchAll(/internal\.(?:fail|error_json)\('([a-z_]+)'/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(40);
    const missing = [...codes].filter((code) => !(code in ERROR_MESSAGES));
    expect(missing).toEqual([]);
  });

  it("donnent les détails utiles", () => {
    expect(flat(errorMessage("not_enough_troops", { available: 1500 }))).toContain(fr(1500));
    expect(flat(errorMessage("too_few_troops", { minimum: 1601 }))).toContain(fr(1601));
    expect(errorMessage("expansion_limit", { limit: 3 })).toContain("3");
    expect(errorMessage("attack_cooldown", { until: "2026-11-06T12:00:00.000Z" })).toContain("2026");
    expect(errorMessage("code_inconnu")).toBe("Une erreur inattendue est survenue.");
  });
});

describe("la liste des droits", () => {
  it("cite chaque fonction publique : rien n'est ouvert ni oublié par accident", () => {
    const declared = [...SQL.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]!);
    const granted = new Set([...SQL.matchAll(/grant execute on function public\.([a-z_]+)\(/g)].map((m) => m[1]!));
    expect(declared.length).toBeGreaterThan(30);
    expect(declared.filter((name) => !granted.has(name))).toEqual([]);
  });

  it("chaque fonction qui contourne les règles d'accès fixe son chemin de recherche", () => {
    const definers = [...SQL.matchAll(/create function ([\s\S]*?)\$\$/g)].filter((m) => /security definer/.test(m[1]!));
    expect(definers.length).toBeGreaterThan(30);
    for (const m of definers) expect(m[1], m[1]!.slice(0, 60)).toContain("set search_path");
  });

  it("toute suppression ou mise à jour garde un WHERE : Supabase refuse sinon", () => {
    const code = SQL.replace(/--.*$/gm, "");
    const writes = [...code.matchAll(/(?:delete from|update) public\.[\w.]+([^;]*);/g)];
    expect(writes.length).toBeGreaterThan(20);
    for (const m of writes) expect(m[0], m[0]).toMatch(/\bwhere\b/);
  });
});

describe("les réglages", () => {
  it("ont tous un nom dans l'administration", () => {
    const paths = flattenConfig(DEFAULT_CONFIG).map(([path]) => path);
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((p) => !CONFIG_LABELS[p])).toEqual([]);
    expect(Object.keys(CONFIG_LABELS).filter((p) => !paths.includes(p))).toEqual([]);
  });

  it("se modifient sans toucher à l'original", () => {
    const changed = withValue(DEFAULT_CONFIG, "limits.attacksPerDay", 9);
    expect(changed.limits.attacksPerDay).toBe(9);
    expect(DEFAULT_CONFIG.limits.attacksPerDay).toBe(5);
    expect(changed.capacity.base).toBe(DEFAULT_CONFIG.capacity.base);
  });
});

describe("le fil d'actualité", () => {
  const base: FeedRow = { id: 1, at: "2026-11-06T12:00:00.000Z", kind: "attack_won", sent: 15_000, losses: 12_869, garrison_before: 10_000, garrison_after: 2131, capsules: null, actor: "Astra", target: "Brenn", territory: "Paris", territory_id: 1 };

  it("annonce un don et ses troupes, sans nommer un donneur anonyme", () => {
    const gift: FeedRow = { ...base, kind: "donation", capsules: 250, sent: 25_000, territory: null, target: null };
    expect(flat(feedText(gift))).toBe(`Astra offre 250 capsules au clan : +${fr(25_000)} troupes en renfort.`);
    expect(flat(feedText({ ...gift, actor: null }))).toBe(`Un membre anonyme offre 250 capsules au clan : +${fr(25_000)} troupes en renfort.`);
    expect(feedText({ ...gift, capsules: 1, sent: 100 })).toBe("Astra offre 1 capsule au clan : +100 troupes en renfort.");
    expect(flat(feedText({ ...gift, sent: 0 }))).toBe("Astra offre 250 capsules au clan : sa réserve est déjà pleine.");
    expect(flat(feedText({ ...gift, kind: "donation_cancelled", sent: 4000 }))).toBe(`Un don de 250 capsules a été annulé par un officier : ${fr(4000)} troupes repartent.`);
  });

  it("raconte « X a pris Paris à Y »", () => {
    expect(feedText(base)).toBe("Astra a pris Paris à Brenn.");
    expect(feedText({ ...base, kind: "attack_lost" })).toBe("Astra a échoué devant Paris, tenu par Brenn.");
    expect(feedText({ ...base, kind: "start" })).toBe("Astra s'installe à Paris.");
    expect(feedText({ ...base, kind: "expand" })).toBe("Astra occupe Paris.");
  });

  it("n'efface pas un compte supprimé : il devient un ancien membre", () => {
    expect(feedText({ ...base, actor: null, target: null })).toBe("Un ancien membre a pris Paris à un ancien membre.");
  });

  it("a un texte pour chaque événement", () => {
    const kinds: EventKind[] = ["season_started", "war_started", "season_closed", "start", "expand", "attack_won", "attack_lost", "player_excluded", "donation", "donation_cancelled"];
    for (const kind of kinds) expect(feedText({ ...base, kind }).length).toBeGreaterThan(5);
    const declared = /kind in \(([^)]*)\)/.exec(SQL)![1]!.match(/'([a-z_]+)'/g)!.map((s) => s.replaceAll("'", ""));
    expect(declared.sort()).toEqual([...kinds].sort());
  });

  it("donne les chiffres d'un combat, et seulement d'un combat", () => {
    expect(flat(feedDetail(base)!)).toContain(fr(2131));
    expect(feedDetail({ ...base, kind: "expand" })).toBeNull();
  });

  it("donne à chaque joueur une couleur stable, et bien répartie", () => {
    expect(playerColor(7)).toBe(playerColor(7));
    const hues = Array.from({ length: 40 }, (_, i) => Number(/hsl\(([\d.]+)/.exec(playerColor(i + 1))![1]));
    const sorted = [...hues].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((h, i) => h - sorted[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(1);
  });
});

describe("les règles écrites pour les membres", () => {
  const cap = (hex: number, caps: number) => Math.round(capacity(hex, caps));

  it("donnent les vrais prix du terrain", () => {
    for (const terrain of ["plains", "highland", "mountain"] as const) expect(RULES).toContain(fr(neutralCost(terrain)));
    expect(RULES).toContain(fr(3000 - neutralCost("plains")));
  });

  it("donnent les vrais chiffres de troupes", () => {
    for (const caps of [0, 1000, 10_000, 100_000]) {
      expect(RULES, `départ ${caps}`).toContain(fr(startingTroops(caps)));
      expect(RULES, `capacité ${caps}`).toContain(fr(cap(5, caps)));
      const week = settle(startingTroops(caps), 7 * 24 * 3_600_000, capacity(5, caps)).troops;
      const written = [...RULES.matchAll(/\d+(?: \d{3})+/g)].map((m) => Number(m[0].replace(/ /g, "")));
      expect(written.some((v) => Math.abs(v - week) <= 25), `7 jours ${caps} : ${week}`).toBe(true);
    }
  });

  it("donnent les vrais exemples de combat", () => {
    for (const [terrain, garrison, sent] of [["plains", 10_000, 15_000], ["plains", 10_000, 12_000], ["mountain", 10_000, 15_000], ["mountain", 10_000, 20_000]] as const) {
      expect(RULES).toContain(fr(resolveAttack(sent, garrison, terrain).garrisonAfter));
    }
  });

  it("citent les vraies limites", () => {
    const { limits } = DEFAULT_CONFIG;
    expect(RULES).toContain(`**${limits.expansionsPerDay} terres libres par jour**`);
    expect(RULES).toContain(`**${limits.attacksPerDay} attaques par jour**`);
    expect(RULES).toContain("**1 heure**");
    expect(limits.attackCooldownMinutes).toBe(60);
    expect(RULES).toContain(`**protégée pendant ${limits.protectionHours} heures**`);
    expect(limits.lastTerritoryProtected).toBe(true);
    expect(RULES).toContain("**Le dernier territoire d'un joueur ne peut pas être attaqué**");
  });

  it("expliquent ce qu'un don rapporte en troupes, avec les vrais chiffres", () => {
    expect(RULES).toContain(`**1 capsule = ${DEFAULT_CONFIG.troopsPerCapsule} troupes**`);
    const cap = Math.floor(capacity(5, 1250));
    expect(RULES).toContain(fr(donationTroops(250, 60_000, cap)));
    expect(RULES).toContain(fr(cap));
    expect(donationTroops(250, 60_000, cap)).toBe(25_000);
    const big = Math.floor(capacity(5, 11_000));
    expect(RULES).toContain(fr(big));
    expect(RULES).toContain(fr(donationTroops(10_000, 60_000, big)));
    expect(RULES).toContain("dans la limite de votre capacité");
  });

  it("disent la vérité sur le délai : un officier valide, OpenFront ne donne pas d'accès", () => {
    expect(RULES).toContain("dès qu'un officier a validé votre don");
  });

  it("rappellent qu'un don est définitif, et que le Plutonium ne compte pas", () => {
    expect(RULES).toContain("**Un don est permanent et non remboursable. Rien ne vous oblige à donner.**");
    expect(RULES).toContain("jamais le Plutonium");
  });
});
