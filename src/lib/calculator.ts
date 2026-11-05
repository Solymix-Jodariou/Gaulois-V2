/**
 * Repère indicatif : troupes à envoyer contre un bot.
 *
 * Réécriture de `EngineConfig.attackLogic` et de la boucle d'`AttackExecution`
 * du jeu OpenFront (AGPL-3.0), commit de référence ci-dessous. La simulation
 * suppose un terrain uniforme et ignore la régénération du bot et les bonus
 * de bâtiments. Elle n'a pas été comparée à des parties réelles.
 */
export const FORMULA_COMMIT = "5b75bd3";

export type Terrain = "plains" | "highland" | "mountain";

export const TERRAINS: Record<Terrain, { label: string; mag: number; tileCost: number }> = {
  plains: { label: "Plaine", mag: 80, tileCost: 16.5 },
  highland: { label: "Colline", mag: 100, tileCost: 20 },
  mountain: { label: "Montagne", mag: 120, tileCost: 25 },
};

const BOT_DEFENDER_LOSS_MULT = 0.7;
const ATTACKER_LOSS_BASE = 0.463;
const ATTACKER_LOSS_PER_DENSITY = 0.0039;
const CHEAPEST_TROOP_RATIO = 0.6;
const SPEED_COST_DIVISOR = 8.55;
const LARGE_MIDPOINT = 300_000;
const LARGE_STEEPNESS = 2.5;
const LARGE_ATTACKER_DEPTH = 0.7;
const LARGE_DEFENDER_DEPTH = 0.3;
const LARGE_ATTACKER_SPEED_DEPTH = 0.73;
/** `borderSize + random(0, 5)` dans le jeu, soit +2 en moyenne. */
const BORDER_RANDOM_AVG = 2;
const TICK_SECONDS = 0.1;

export const MAX_BOT_TILES = 200_000;

const within = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const sigmoid = (v: number, k: number, m: number) => 1 / (1 + Math.exp(-k * (v - m)));
const largeBonus = (tiles: number, depth: number) =>
  1 - depth * sigmoid(Math.log(tiles), LARGE_STEEPNESS, Math.log(LARGE_MIDPOINT));

export interface CalcInput {
  botTroops: number;
  botTiles: number;
  terrain: Terrain;
  /** Longueur de la frontière d'attaque, en cases. */
  border: number;
  /** Territoire de l'attaquant, en cases. */
  myTiles: number;
}

/** Pertes de l'attaquant sur une case, formule du jeu pour un humain contre un bot. */
export function tileLoss(
  attack: number,
  botTroops: number,
  botTiles: number,
  myTiles: number,
  terrain: Terrain,
): number {
  const { mag } = TERRAINS[terrain];
  const ratio = within(botTroops / attack, CHEAPEST_TROOP_RATIO, 2);
  return (
    mag *
    BOT_DEFENDER_LOSS_MULT *
    ratio *
    (ATTACKER_LOSS_BASE * largeBonus(myTiles, LARGE_ATTACKER_DEPTH) * largeBonus(botTiles, LARGE_DEFENDER_DEPTH) +
      ATTACKER_LOSS_PER_DENSITY * (botTroops / botTiles))
  );
}

export interface SimResult {
  success: boolean;
  /** Troupes restantes à la fin. */
  remaining: number;
  /** Cases conquises. */
  conquered: number;
  seconds: number;
}

export function simulate(attack: number, input: CalcInput): SimResult {
  const { botTiles, terrain, myTiles } = input;
  const border = input.border + BORDER_RANDOM_AVG;
  let a = attack;
  let d = input.botTroops;
  let n = botTiles;
  let me = myTiles;
  let ticks = 0;
  while (n > 0) {
    if (a < 1) return { success: false, remaining: 0, conquered: botTiles - n, seconds: ticks * TICK_SECONDS };
    const ratio = d / a;
    const speed = (within(ratio, 0.82, 7.5) * within(ratio / 20, 1, 50)) / SPEED_COST_DIVISOR;
    ticks +=
      (speed *
        TERRAINS[terrain].tileCost *
        largeBonus(me, LARGE_ATTACKER_SPEED_DEPTH) *
        largeBonus(n, LARGE_DEFENDER_DEPTH)) /
      border;
    a -= tileLoss(a, d, n, me, terrain);
    d -= d / n;
    n -= 1;
    me += 1;
  }
  return { success: a >= 1, remaining: Math.max(0, a), conquered: botTiles, seconds: ticks * TICK_SECONDS };
}

export interface CalcResult {
  /** Plus petit envoi qui conquiert tout le bot selon le modèle. */
  minimum: number;
  /** Multiple des troupes du bot. */
  multiple: number;
  /** Durée estimée avec cet envoi minimal. */
  seconds: number;
}

export function validateInput(i: CalcInput): boolean {
  return (
    Number.isFinite(i.botTroops) &&
    i.botTroops > 0 &&
    Number.isInteger(i.botTiles) &&
    i.botTiles > 0 &&
    i.botTiles <= MAX_BOT_TILES &&
    Number.isFinite(i.border) &&
    i.border >= 1 &&
    Number.isFinite(i.myTiles) &&
    i.myTiles >= 1
  );
}

export function minimumTroops(input: CalcInput): CalcResult | null {
  if (!validateInput(input)) return null;
  let lo = 1;
  let hi = Math.max(1000, input.botTroops);
  while (!simulate(hi, input).success) hi *= 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (simulate(mid, input).success) hi = mid;
    else lo = mid;
  }
  return { minimum: hi, multiple: hi / input.botTroops, seconds: simulate(hi, input).seconds };
}
