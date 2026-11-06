/**
 * Le guide de première partie : il accompagne la vraie partie du joueur, sans la simuler.
 * Chaque étape se déduit de l'état réel du jeu : recharger la page, ou revenir trois jours plus tard,
 * ne fait rien perdre. Seules les explications déjà lues sont retenues, dans `seen`.
 * Aucune règle n'est écrite en dur : les chiffres viennent des réglages de la saison.
 */
import { fmtDateTime, fmtInt } from "../format";
import { DEFAULT_CONFIG, buildingCost, neutralCost, troopsForRatio, type BuildingKind, type ConquestConfig } from "./rules";
import type { GameMap, MapTerritory, Phase } from "./types";

/** La partie de l'écran que l'étape met en avant. */
export type GuideSpot = "action" | "command" | "ratio" | "build" | "diplomacy";
/** Ce que le guide peut choisir pour le joueur, s'il préfère qu'on lui montre. */
export type GuideProposal = "start" | "expand" | "attack" | "own";

export interface GuideStep {
  id: string;
  title: string;
  body: string[];
  spot: GuideSpot | null;
  /** Position dans le guide. */
  number: number;
  total: number;
  /** Le bouton principal : passer à la suite, ou montrer une terre. */
  primary: { label: string; ack: boolean; proposal?: GuideProposal } | null;
  /** Remettre à plus tard une étape facultative. */
  later: string | null;
}

export interface SelectedLand {
  name: string;
  kind: "free" | "mine" | "enemy" | "ally";
  /** À portée d'action, d'après les voisins du joueur. */
  reachable: boolean;
  cost: number;
}

export interface GuideContext {
  config: ConquestConfig;
  phase: Phase;
  warStartsAt: string | null;
  /** Mes terres. */
  owned: number;
  freeLands: number;
  reachableFree: number;
  reachableEnemies: number;
  selected: SelectedLand | null;
  reserve: number;
  nextRegen: number;
  gold: number;
  goldPerHour: number;
  ratio: number;
  hasBuilding: boolean;
  /** Le joueur a déjà attaqué dans cette saison. */
  attacked: boolean;
  expansionsLeft: number;
  /** Les étapes déjà lues ou remises à plus tard. */
  seen: ReadonlySet<string>;
}

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n > 1 ? many : one}`;
const percent = (share: number) => `${Math.round(share * 100)} %`;

/** Le bâtiment le moins cher, pour dire honnêtement quand le premier sera à portée. */
function cheapestBuilding(config: ConquestConfig): { kind: BuildingKind; cost: number } {
  const kinds: BuildingKind[] = ["post", "port", "city", "sam", "silo"];
  return kinds.map((kind) => ({ kind, cost: buildingCost(kind, 0, config) })).sort((a, b) => a.cost - b.cost)[0]!;
}

const BUILDING_NAMES: Record<BuildingKind, string> = { city: "une ville", port: "un port", post: "un poste de défense", sam: "une défense antiaérienne", silo: "un silo" };

interface StepCopy {
  title: string;
  body: string[];
  spot?: GuideSpot;
  primary?: GuideStep["primary"];
  later?: string;
}

const ACK = (label: string): GuideStep["primary"] => ({ label, ack: true });

const COPY: Record<string, (c: GuideContext) => StepCopy> = {
  welcome: (c) => ({
    title: "Bienvenue dans la Conquête",
    body: [
      `Le but : tenir ${percent(c.config.victoryShare)} de la carte avant les autres membres. Une saison dure plusieurs jours : quelques minutes par visite suffisent.`,
      "Ce guide vous accompagne pendant votre vraie partie. Chaque action compte, et vous pouvez le fermer à tout moment.",
    ],
    primary: ACK("C'est parti"),
  }),
  no_land: () => ({
    title: "Toutes les terres sont occupées",
    body: ["Il n'y a plus de terre libre pour s'installer dans cette saison. Vous la suivez en spectateur, et vous pourrez jouer dès la prochaine."],
    primary: ACK("Compris"),
  }),
  choose: (c) => ({
    title: "Choisissez votre terre de départ",
    body: [
      c.selected ? `${c.selected.name} est déjà prise : choisissez une terre libre.` : "Cliquez une terre libre sur la carte, ou laissez le guide vous en proposer une.",
      `Conquérir autour de vous coûtera ${fmtInt(neutralCost("plains", c.config))} troupes par plaine, ${fmtInt(neutralCost("mountain", c.config))} par montagne. Mieux vaut donc s'installer près des plaines, et loin des autres joueurs.`,
    ],
    primary: { label: "Me proposer une terre", ack: false, proposal: "start" },
  }),
  settle: (c) => {
    const garrison = troopsForRatio(c.reserve, c.ratio);
    return {
      title: `Installez-vous à ${c.selected?.name ?? "cette terre"}`,
      body: [
        `Elle est gratuite : les ${plural(garrison, "troupe", "troupes")} que vous y placez deviennent sa garnison, et les autres restent en réserve pour conquérir. Vous pourrez la renforcer plus tard.`,
        `Elle sera protégée ${c.config.limits.protectionHours} heures. Ce choix vaut pour toute la saison : appuyez sur « Choisir comme territoire de départ » dans le panneau, ou cliquez une autre terre.`,
      ],
      spot: "action",
    };
  },
  resources: (c) => ({
    title: "Vos ressources",
    body: [
      `Troupes : votre réserve et son plafond. Elle monte toute seule, de ${plural(Math.max(c.nextRegen, 0), "troupe", "troupes")} à la prochaine heure. Plus vous tenez de terres, plus le plafond est haut.`,
      `Or : ${fmtInt(c.goldPerHour)} par heure, pour construire. Conquêtes et attaques : vos limites du jour, remises à zéro à minuit.`,
    ],
    spot: "command",
    primary: ACK("Compris"),
  }),
  expand: (c) => {
    const target = c.selected?.kind === "free" && c.selected.reachable ? c.selected : null;
    return {
      title: "Conquérez une terre voisine",
      body: target
        ? [`${target.name} coûte ${plural(target.cost, "troupe", "troupes")} : le panneau montre ce qu'il restera en garnison.`, "Pour y aller, cliquez encore sur la terre, ou sur « Conquérir ce territoire »."]
        : ["Les cases jaunes sont à votre portée. Cliquez-en une : le panneau montre son prix et ce qu'il restera en garnison.", `Vous pouvez en conquérir ${c.config.limits.expansionsPerDay} par jour.`],
      ...(target ? { spot: "action" as const } : { primary: { label: "Me proposer une cible", ack: false, proposal: "expand" as const } }),
      later: "Plus tard",
    };
  },
  ratio: (c) => ({
    title: "Le ratio d'attaque",
    body: [
      `Cette réglette fixe la part de votre réserve envoyée à chaque action : ${c.ratio} %, soit ${plural(troopsForRatio(c.reserve, c.ratio), "troupe", "troupes")} en ce moment.`,
      "Le panneau montre toujours le résultat avant que vos troupes partent, et vous pouvez y taper le nombre exact.",
    ],
    spot: "ratio",
    primary: ACK("Compris"),
  }),
  reinforce: (c) => ({
    title: "Renforcez une terre",
    body: [
      c.selected?.kind === "mine" ? `Indiquez le nombre de troupes pour ${c.selected.name}, puis appuyez sur « Renforcer ce territoire ».` : "Choisissez une de vos terres, de préférence une qui touche un autre joueur.",
      "Vos troupes passent de la réserve à la garnison, sans frais. Elles n'en reviennent pas : gardez-en assez pour conquérir.",
    ],
    ...(c.selected?.kind === "mine" ? { spot: "action" as const } : { primary: { label: "Choisir une de mes terres", ack: false, proposal: "own" as const } }),
    later: "Plus tard",
  }),
  build: (c) => {
    const { kind, cost } = cheapestBuilding(c.config);
    const missing = cost - c.gold;
    const hours = c.goldPerHour > 0 ? Math.ceil(missing / c.goldPerHour) : null;
    return {
      title: "Construisez votre premier bâtiment",
      body: [
        c.selected?.kind === "mine" ? "Regardez « Construire ici » dans le panneau : chaque bâtiment dit ce qu'il apporte. Une terre n'en porte qu'un, et il change de main avec elle." : "Choisissez une de vos terres pour voir ce que vous pouvez y construire. Une terre ne porte qu'un bâtiment, et il change de main avec elle.",
        missing > 0
          ? `Le moins cher, ${BUILDING_NAMES[kind]}, coûte ${fmtInt(cost)} d'or. Il vous en manque ${fmtInt(missing)}${hours !== null ? `, soit environ ${plural(hours, "heure", "heures")}` : ""}.`
          : `Vous avez ${fmtInt(c.gold)} d'or : de quoi construire ${BUILDING_NAMES[kind]}, à ${fmtInt(cost)}.`,
      ],
      ...(c.selected?.kind === "mine" ? { spot: "build" as const } : { primary: { label: "Choisir une de mes terres", ack: false, proposal: "own" as const } }),
      later: "Plus tard",
    };
  },
  plan: (c) => ({
    title: "Et maintenant ?",
    body: [
      `Revenez quand vous voulez : votre réserve et votre or montent pendant votre absence, et vous pouvez conquérir ${c.config.limits.expansionsPerDay} terres par jour.`,
      `La guerre commence ${c.warStartsAt ? `le ${fmtDateTime(c.warStartsAt)}, ou avant si` : "quand"} toutes les terres sont occupées. Ce guide reviendra à ce moment-là.`,
    ],
    primary: ACK("Compris"),
  }),
  attack: (c) => {
    const target = c.selected?.kind === "enemy" && c.selected.reachable ? c.selected : null;
    return {
      title: "La guerre : attaquez un voisin",
      body: target
        ? [`Le panneau annonce le résultat exact à ${target.name}, sans aucun hasard. « Juste assez » propose le minimum pour gagner.`, "Si la victoire est annoncée, cliquez encore sur la terre, ou sur « Attaquer ce territoire »."]
        : [
            c.reachableEnemies > 0 ? "Cliquez la terre d'un autre joueur, parmi les cases jaunes. Le panneau annonce le résultat exact avant que vos troupes partent." : "Aucun joueur ne touche encore vos terres : étendez-vous jusqu'à l'un d'eux.",
            `Une garnison est retranchée : il faut en général 1,3 à 1,7 fois ses troupes pour la battre. Attendez ${c.config.limits.attackCooldownMinutes} minutes entre deux attaques.`,
          ],
      ...(target ? { spot: "action" as const } : c.reachableEnemies > 0 ? { primary: { label: "Me proposer une cible", ack: false, proposal: "attack" as const } } : {}),
      later: "Plus tard",
    };
  },
  alliance: (c) => ({
    title: "Alliés et traîtres",
    body: [
      `Depuis la terre d'un autre joueur, proposez une alliance : ${c.config.alliance.hours} heures sans vous attaquer, s'il accepte.`,
      `La rompre, c'est trahir : tout le monde le voit, et vous attaquer coûte moitié moins pendant ${c.config.alliance.traitorHours} heures.`,
    ],
    primary: ACK("Compris"),
  }),
  done: (c) => ({
    title: "Vous êtes prêt !",
    body: [
      "Le fil d'actualité, les classements et la liste des terres sont sous la carte. Les règles complètes sont sur la page « Les règles », et le bouton « Guide » relance ces conseils.",
      c.config.troopsPerCapsule > 0 ? `Vos dons de capsules au clan deviennent des troupes : ${plural(c.config.troopsPerCapsule, "troupe", "troupes")} par capsule, à déclarer sur « Mon compte ». Rien ne vous oblige à donner.` : "",
    ].filter(Boolean),
    primary: ACK("Terminer"),
  }),
};

/** L'étape est-elle derrière le joueur ? */
function isDone(id: string, c: GuideContext): boolean {
  switch (id) {
    case "welcome":
      return c.seen.has(id) || c.owned > 0;
    case "no_land":
      return c.seen.has(id) || c.owned > 0 || c.freeLands > 0;
    case "choose":
      return c.owned > 0 || c.freeLands === 0 || c.selected?.kind === "free";
    case "settle":
      return c.owned > 0 || c.freeLands === 0;
    case "expand":
      return c.seen.has(id) || c.owned >= 2 || c.reachableFree === 0 || c.expansionsLeft <= 0;
    case "build":
      return c.seen.has(id) || c.hasBuilding;
    case "attack":
      return c.seen.has(id) || c.attacked;
    default:
      return c.seen.has(id);
  }
}

/** Les étapes qui ont un sens maintenant : la guerre n'est expliquée qu'une fois commencée. */
function stepsFor(c: GuideContext): string[] {
  const common = ["welcome", "no_land", "choose", "settle", "resources", "expand", "ratio", "reinforce", "build"];
  // Sans terre et sans espoir d'en avoir, seule l'explication reste.
  if (c.owned === 0 && c.freeLands === 0) return ["welcome", "no_land"];
  const list = common.filter((id) => id !== "no_land");
  return c.phase === "war" ? [...list, "attack", "alliance", "done"] : [...list, "plan", "done"];
}

/** L'étape en cours, ou rien si tout est fait. */
export function currentGuideStep(c: GuideContext): GuideStep | null {
  const steps = stepsFor(c);
  const index = steps.findIndex((id) => !isDone(id, c));
  if (index === -1) return null;
  const id = steps[index]!;
  const copy = COPY[id]!(c);
  return { id, title: copy.title, body: copy.body, spot: copy.spot ?? null, number: index + 1, total: steps.length, primary: copy.primary ?? null, later: copy.later ?? null };
}

/** Le guide s'efface tout seul devant quelqu'un qui joue déjà. */
export const VETERAN_LANDS = 3;

/* ---------- Ce que le guide propose quand on le lui demande ---------- */

type Lands = ReadonlyMap<number, { owner: number; garrison: number; protected_until?: string | null }>;
const distance = (a: MapTerritory, b: MapTerritory) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Une bonne terre de départ : beaucoup de plaines libres autour, personne à côté, et loin des autres.
 * Ce n'est qu'un conseil : le joueur reste libre, et le calcul ne regarde que ce qui est public.
 */
export function suggestStarts(map: Pick<GameMap, "territories">, lands: Lands, count = 1): number[] {
  const occupied = map.territories.filter((t) => lands.has(t.id));
  const scored = map.territories
    .filter((t) => !lands.has(t.id))
    .map((t) => {
      let score = t.terrain === "plains" ? 2 : t.terrain === "highland" ? 1 : 0;
      for (const n of t.neighbours) {
        const neighbour = map.territories[n - 1];
        if (!neighbour) continue;
        if (lands.has(n)) score -= 8;
        else score += neighbour.terrain === "plains" ? 3 : neighbour.terrain === "highland" ? 2 : 1;
      }
      const nearest = occupied.length > 0 ? Math.min(...occupied.map((o) => distance(o, t))) : 60;
      return { id: t.id, t, score: score + Math.min(nearest, 60) / 10 };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
  // Plusieurs conseils : assez éloignés pour être de vrais choix.
  const picked: typeof scored = [];
  for (const candidate of scored) {
    if (picked.length >= count) break;
    if (picked.every((p) => distance(p.t, candidate.t) > 40)) picked.push(candidate);
  }
  return picked.map((p) => p.id);
}

const reachableFrom = (map: Pick<GameMap, "territories">, owned: ReadonlySet<number>) => {
  const out = new Set<number>();
  for (const id of owned) for (const n of map.territories[id - 1]?.neighbours ?? []) if (!owned.has(n)) out.add(n);
  return out;
};

/** La terre libre voisine la moins chère, celle qui ouvre le plus de terres libres en cas d'égalité. */
export function suggestExpansion(map: Pick<GameMap, "territories">, lands: Lands, owned: ReadonlySet<number>, c: ConquestConfig = DEFAULT_CONFIG): number | null {
  const options = [...reachableFrom(map, owned)].filter((id) => !lands.has(id)).map((id) => map.territories[id - 1]!);
  const open = (t: MapTerritory) => t.neighbours.filter((n) => !lands.has(n) && !owned.has(n)).length;
  options.sort((a, b) => neutralCost(a.terrain, c) - neutralCost(b.terrain, c) || open(b) - open(a) || a.id - b.id);
  return options[0]?.id ?? null;
}

/** La terre ennemie voisine la plus faible qu'on ait le droit d'attaquer : ni alliée, ni protégée, ni la dernière de son joueur. */
export function suggestAttack(map: Pick<GameMap, "territories">, lands: Lands, owned: ReadonlySet<number>, allies: ReadonlySet<number>, landsOf: (owner: number) => number, now: number, c: ConquestConfig = DEFAULT_CONFIG): number | null {
  const options = [...reachableFrom(map, owned)].filter((id) => {
    const land = lands.get(id);
    if (!land || allies.has(land.owner)) return false;
    if (land.protected_until && Date.parse(land.protected_until) > now) return false;
    return !(c.limits.lastTerritoryProtected && landsOf(land.owner) <= 1);
  });
  options.sort((a, b) => lands.get(a)!.garrison * c.terrain[map.territories[a - 1]!.terrain] - lands.get(b)!.garrison * c.terrain[map.territories[b - 1]!.terrain] || a - b);
  return options[0] ?? null;
}

/** Une de mes terres : celle qui a le plus de voisins qui ne sont pas à moi, là où une garnison sert. */
export function suggestOwn(map: Pick<GameMap, "territories">, owned: ReadonlySet<number>): number | null {
  const options = [...owned].map((id) => map.territories[id - 1]!).filter(Boolean);
  options.sort((a, b) => b.neighbours.filter((n) => !owned.has(n)).length - a.neighbours.filter((n) => !owned.has(n)).length || a.id - b.id);
  return options[0]?.id ?? null;
}
