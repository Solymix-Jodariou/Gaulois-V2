import { describe, expect, it } from "vitest";
import { VETERAN_LANDS, currentGuideStep, suggestAttack, suggestExpansion, suggestOwn, suggestStarts, type GuideContext } from "../../src/lib/conquete/guide";
import { DEFAULT_CONFIG, neutralCost } from "../../src/lib/conquete/rules";
import { MAX_NOTICES, newNotices, noticeFor } from "../../src/lib/conquete/notices";
import type { FeedRow, GameMap, MapTerritory } from "../../src/lib/conquete/types";
import { MAP } from "../support/game";

const flat = (s: string) => s.replace(/\s/g, " ");
const base: GuideContext = {
  config: DEFAULT_CONFIG,
  phase: "expansion",
  warStartsAt: null,
  owned: 0,
  freeLands: 400,
  reachableFree: 0,
  reachableEnemies: 0,
  selected: null,
  reserve: 25_000,
  nextRegen: 0,
  gold: 5000,
  goldPerHour: 0,
  ratio: 20,
  hasBuilding: false,
  attacked: false,
  expansionsLeft: 10,
  seen: new Set(),
};
const ctx = (change: Partial<GuideContext> & { read?: string[] } = {}): GuideContext => {
  const { read, ...rest } = change;
  return { ...base, ...rest, seen: new Set(read ?? []) };
};
const stepId = (change: Parameters<typeof ctx>[0] = {}) => currentGuideStep(ctx(change))?.id ?? null;
const free = (name = "Paris") => ({ name, kind: "free" as const, reachable: false, cost: 1600 });

describe("le guide suit la vraie partie", () => {
  it("commence par accueillir, puis fait choisir une terre", () => {
    expect(stepId()).toBe("welcome");
    expect(stepId({ read: ["welcome"] })).toBe("choose");
  });

  it("choisir une terre libre fait passer à l'installation, sans rien lire de plus", () => {
    const step = currentGuideStep(ctx({ read: ["welcome"], selected: free("Lyon") }))!;
    expect(step.id).toBe("settle");
    expect(step.title).toContain("Lyon");
    expect(step.spot).toBe("action");
  });

  it("une terre déjà prise ramène au choix, et le dit", () => {
    const step = currentGuideStep(ctx({ read: ["welcome"], selected: { name: "Berlin", kind: "enemy", reachable: false, cost: 0 } }))!;
    expect(step.id).toBe("choose");
    expect(step.body[0]).toContain("Berlin est déjà prise");
  });

  it("une fois installé, l'étape passe d'elle-même, même après un rechargement", () => {
    expect(stepId({ owned: 1 })).toBe("resources");
    expect(stepId({ owned: 1, read: ["resources"], reachableFree: 4 })).toBe("expand");
  });

  it("montre le prix réel de la terre visée, et comment y aller", () => {
    const step = currentGuideStep(ctx({ owned: 1, read: ["resources"], reachableFree: 4, selected: { name: "Lyon", kind: "free", reachable: true, cost: neutralCost("highland") } }))!;
    expect(flat(step.body[0]!)).toContain(`Lyon coûte ${flat(new Intl.NumberFormat("fr-FR").format(neutralCost("highland")))} troupes`);
    expect(step.body[1]).toContain("cliquez encore sur la terre");
    expect(step.primary).toBeNull();
  });

  it("se déroule jusqu'au bout pendant l'expansion, sans parler de la guerre", () => {
    const order: string[] = [];
    const read: string[] = [];
    let owned = 0;
    let selected: GuideContext["selected"] = null;
    for (let i = 0; i < 30; i++) {
      const step = currentGuideStep(ctx({ read, owned, selected, reachableFree: owned > 0 ? 3 : 0 }));
      if (!step) break;
      order.push(step.id);
      if (step.id === "choose") selected = free();
      else if (step.id === "settle") {
        owned = 1;
        selected = null;
      } else if (step.id === "expand") owned = 2;
      else read.push(step.id);
    }
    expect(order).toEqual(["welcome", "choose", "settle", "resources", "expand", "ratio", "reinforce", "build", "plan", "done"]);
  });

  it("revient quand la guerre commence, pour l'expliquer", () => {
    const read = ["welcome", "resources", "expand", "ratio", "reinforce", "build", "plan", "done"];
    expect(stepId({ owned: 5, read })).toBeNull();
    const step = currentGuideStep(ctx({ owned: 5, read, phase: "war", reachableEnemies: 2 }))!;
    expect(step.id).toBe("attack");
    expect(step.primary?.proposal).toBe("attack");
    expect(stepId({ owned: 5, read: [...read, "attack"], phase: "war" })).toBe("alliance");
    expect(stepId({ owned: 5, read: [...read, "attack", "alliance"], phase: "war" })).toBeNull();
  });

  it("une attaque déjà lancée vaut pour l'étape", () => {
    expect(stepId({ owned: 5, phase: "war", attacked: true, read: ["resources", "ratio", "reinforce", "build"] })).toBe("alliance");
  });

  it("sans voisin à attaquer, il le dit et ne propose rien d'impossible", () => {
    const step = currentGuideStep(ctx({ owned: 2, phase: "war", read: ["resources", "ratio", "reinforce", "build"] }))!;
    expect(step.id).toBe("attack");
    expect(step.body[0]).toContain("étendez-vous");
    expect(step.primary).toBeNull();
    expect(step.later).toBe("Plus tard");
  });

  it("passe la conquête quand il n'y a rien à conquérir, ou que le quota du jour est fait", () => {
    expect(stepId({ owned: 1, read: ["resources"], reachableFree: 0 })).toBe("ratio");
    expect(stepId({ owned: 1, read: ["resources"], reachableFree: 3, expansionsLeft: 0 })).toBe("ratio");
  });

  it("dit honnêtement quand il n'y a plus de terre libre", () => {
    const step = currentGuideStep(ctx({ freeLands: 0, read: ["welcome"] }))!;
    expect(step.id).toBe("no_land");
    expect(stepId({ freeLands: 0, read: ["welcome", "no_land"] })).toBeNull();
  });

  it("dit combien d'or il manque, et dans combien de temps", () => {
    const step = currentGuideStep(ctx({ owned: 2, gold: 1000, goldPerHour: 200, read: ["resources", "expand", "ratio", "reinforce"] }))!;
    expect(step.id).toBe("build");
    expect(flat(step.body[1]!)).toContain("Il vous en manque 4 000, soit environ 20 heures");
    const rich = currentGuideStep(ctx({ owned: 2, gold: 9000, read: ["resources", "expand", "ratio", "reinforce"] }))!;
    expect(flat(rich.body[1]!)).toContain("Vous avez 9 000 d'or");
  });

  it("un bâtiment déjà construit vaut pour l'étape", () => {
    expect(stepId({ owned: 2, hasBuilding: true, read: ["resources", "expand", "ratio", "reinforce"] })).toBe("plan");
  });

  it("annonce la date de la guerre quand elle est fixée", () => {
    const step = currentGuideStep(ctx({ owned: 2, warStartsAt: "2026-11-20T18:00:00.000Z", hasBuilding: true, read: ["resources", "expand", "ratio", "reinforce", "build"] }))!;
    expect(step.id).toBe("plan");
    expect(step.body[1]).toContain("2026");
    expect(step.body[1]).toContain("ou avant si");
  });

  it("numérote ses étapes sans jamais dépasser le total", () => {
    const step = currentGuideStep(ctx())!;
    expect(step.number).toBe(1);
    expect(step.total).toBeGreaterThan(8);
    const later = currentGuideStep(ctx({ owned: 2, hasBuilding: true, read: ["resources", "expand", "ratio", "reinforce", "build"] }))!;
    expect(later.number).toBeLessThanOrEqual(later.total);
    expect(later.number).toBeGreaterThan(step.number);
  });

  it("ses textes suivent les réglages de la saison, sans chiffre écrit en dur", () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
    config.victoryShare = 0.6;
    config.limits.expansionsPerDay = 7;
    expect(currentGuideStep(ctx({ config }))!.body[0]).toContain("60 %");
    expect(currentGuideStep(ctx({ config, owned: 1, read: ["resources"], reachableFree: 3 }))!.body[1]).toContain("7 par jour");
  });

  it("ne pousse jamais à donner", () => {
    const step = currentGuideStep(ctx({ owned: 2, read: ["resources", "expand", "ratio", "reinforce", "build", "plan"] }))!;
    expect(step.id).toBe("done");
    expect(step.body.join(" ")).toContain("Rien ne vous oblige à donner");
  });

  it("s'efface devant quelqu'un qui joue déjà", () => {
    expect(VETERAN_LANDS).toBeGreaterThan(1);
  });
});

describe("les propositions du guide", () => {
  const map = MAP as unknown as GameMap;
  const byId = (id: number) => map.territories[id - 1] as MapTerritory;
  const land = (owner: number, garrison = 1000, protected_until: string | null = null) => ({ owner, garrison, protected_until });

  it("propose une terre libre, avec des plaines autour", () => {
    const [id] = suggestStarts(map, new Map());
    const t = byId(id!);
    expect(t.terrain).toBe("plains");
    expect(t.neighbours.filter((n) => byId(n).terrain === "plains").length).toBeGreaterThanOrEqual(3);
  });

  it("ne propose jamais une terre prise, et s'éloigne des autres joueurs", () => {
    const [first] = suggestStarts(map, new Map());
    const lands = new Map<number, ReturnType<typeof land>>([[first!, land(1)], ...byId(first!).neighbours.map((n) => [n, land(1)] as [number, ReturnType<typeof land>])]);
    const [next] = suggestStarts(map, lands);
    expect(lands.has(next!)).toBe(false);
    expect(byId(next!).neighbours.some((n) => lands.has(n))).toBe(false);
  });

  it("donne plusieurs choix bien séparés", () => {
    const ids = suggestStarts(map, new Map(), 3);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const a of ids) for (const b of ids) if (a !== b) expect(Math.hypot(byId(a).x - byId(b).x, byId(a).y - byId(b).y)).toBeGreaterThan(40);
  });

  it("propose la conquête voisine la moins chère", () => {
    const home = map.territories.find((t) => new Set(t.neighbours.map((n) => byId(n).terrain)).size > 1)!;
    const owned = new Set([home.id]);
    const lands = new Map([[home.id, land(1)]]);
    const id = suggestExpansion(map, lands, owned)!;
    expect(home.neighbours).toContain(id);
    const cheapest = Math.min(...home.neighbours.map((n) => neutralCost(byId(n).terrain)));
    expect(neutralCost(byId(id).terrain)).toBe(cheapest);
  });

  it("n'a rien à proposer quand tout est pris", () => {
    const home = map.territories[0]!;
    const lands = new Map<number, ReturnType<typeof land>>([[home.id, land(1)], ...home.neighbours.map((n) => [n, land(2)] as [number, ReturnType<typeof land>])]);
    expect(suggestExpansion(map, lands, new Set([home.id]))).toBeNull();
  });

  it("n'attaque ni un allié, ni une terre protégée, ni le dernier territoire d'un joueur", () => {
    const home = map.territories.find((t) => t.neighbours.length >= 4)!;
    const [ally, shielded, lonely, weak] = home.neighbours as [number, number, number, number];
    const now = Date.parse("2026-11-06T12:00:00Z");
    const lands = new Map([
      [home.id, land(1)],
      [ally, land(2, 1)],
      [shielded, land(3, 1, "2026-11-06T13:00:00Z")],
      [lonely, land(4, 1)],
      [weak, land(5, 500)],
    ]);
    const counts: Record<number, number> = { 2: 5, 3: 5, 4: 1, 5: 5 };
    expect(suggestAttack(map, lands, new Set([home.id]), new Set([2]), (o) => counts[o] ?? 0, now)).toBe(weak);
    expect(suggestAttack(map, lands, new Set([home.id]), new Set([2, 5]), (o) => counts[o] ?? 0, now)).toBeNull();
  });

  it("choisit parmi mes terres celle qui touche le plus d'autres terres", () => {
    const home = map.territories.find((t) => t.neighbours.length >= 5)!;
    const owned = new Set([home.id, home.neighbours[0]!]);
    expect(owned.has(suggestOwn(map, owned)!)).toBe(true);
    expect(suggestOwn(map, new Set())).toBeNull();
  });
});

describe("les annonces au joueur", () => {
  const row = (change: Partial<FeedRow>): FeedRow => ({ id: 10, at: "2026-11-06T12:00:00.000Z", kind: "attack_won", sent: 15_000, losses: 12_000, garrison_before: 10_000, garrison_after: 2131, capsules: null, actor: "Astra", actor_number: 1, target: "Brenn", target_number: 2, territory: "Paris", territory_id: 7, ...change });

  it("prévient celui qu'on attaque, et lui seul", () => {
    expect(noticeFor(row({}), 2)).toMatchObject({ tone: "danger", text: "Astra vous a pris Paris.", sticky: true, territoryId: 7 });
    expect(noticeFor(row({}), 1)).toBeNull();
    expect(noticeFor(row({}), 3)).toBeNull();
    expect(noticeFor(row({}), null)).toBeNull();
  });

  it("donne les bonnes nouvelles aussi, sans les faire rester", () => {
    expect(flat(noticeFor(row({ kind: "attack_lost" }), 2)!.text)).toBe("Astra a échoué devant Paris : votre garnison tombe à 2 131.");
    expect(noticeFor(row({ kind: "attack_lost" }), 2)).toMatchObject({ tone: "good", sticky: false });
    expect(noticeFor(row({ kind: "bomb_intercepted" }), 2)!.text).toBe("Votre défense a arrêté la bombe de Astra sur Paris.");
  });

  it("annonce la bombe, la trahison et l'alliance à qui elles touchent", () => {
    expect(flat(noticeFor(row({ kind: "bomb", garrison_before: 8000, garrison_after: 2000 }), 2)!.text)).toContain("de 8 000 à 2 000");
    expect(noticeFor(row({ kind: "alliance_broken" }), 2)).toMatchObject({ tone: "danger" });
    expect(noticeFor(row({ kind: "alliance_broken" }), 1)).toBeNull();
    expect(noticeFor(row({ kind: "alliance_made" }), 2)!.text).toContain("allié à Astra");
    expect(noticeFor(row({ kind: "alliance_made" }), 1)!.text).toContain("allié à Brenn");
    expect(noticeFor(row({ kind: "alliance_made" }), 3)).toBeNull();
  });

  it("annonce à tous les grands moments et les dons, sans bruit pour le reste", () => {
    expect(noticeFor(row({ kind: "war_started", actor: null, actor_number: null, target: null, target_number: null }), 3)).toMatchObject({ tone: "info", personal: false });
    expect(noticeFor(row({ kind: "victory", target: null, target_number: null }), 3)!.text).toContain("remporte la saison");
    expect(noticeFor(row({ kind: "donation", capsules: 250, sent: 25_000, target: null, target_number: null }), 3)!.text).toContain("offre 250 capsules");
    for (const kind of ["start", "expand", "building", "season_started", "season_closed", "player_excluded"] as const) expect(noticeFor(row({ kind }), 2), kind).toBeNull();
  });

  it("garde l'anonymat : un don anonyme n'est à personne", () => {
    expect(noticeFor(row({ kind: "donation", actor: null, actor_number: null, capsules: 10, sent: 1000 }), 1)).toMatchObject({ personal: false });
    expect(noticeFor(row({ kind: "donation", capsules: 10, sent: 1000 }), 1)).toMatchObject({ personal: true });
  });

  it("ne garde que les nouvelles, et compte le reste", () => {
    const rows = [14, 13, 12, 11, 10, 9].map((id) => row({ id }));
    const { shown, more } = newNotices(rows, 2, 9, false);
    expect(shown.map((n) => n.id)).toEqual([14, 13, 12]);
    expect(shown).toHaveLength(MAX_NOTICES);
    expect(more).toBe(2);
    expect(newNotices(rows, 2, 14, false).shown).toEqual([]);
  });

  it("au retour d'une absence, retient ce qui vous touche et le début de la guerre, pas les dons des autres", () => {
    const rows = [row({ id: 5, kind: "donation", capsules: 1, sent: 100 }), row({ id: 4, kind: "war_started" }), row({ id: 3 }), row({ id: 2, kind: "victory" })];
    expect(newNotices(rows, 2, 0, true).shown.map((n) => n.id)).toEqual([4, 3]);
    expect(newNotices(rows, 2, 0, false).shown.map((n) => n.id)).toEqual([5, 4, 3]);
  });
});
