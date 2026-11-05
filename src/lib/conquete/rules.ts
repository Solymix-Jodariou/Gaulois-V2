/**
 * Les formules de la Conquête, adaptées d'OpenFront (commit 5b75bd3, AGPL-3.0) : réécrites,
 * pas copiées. Les réglages sont dans config/conquete.json.
 *
 * Ce fichier ne sert qu'à prévoir un résultat à l'écran. Le calcul qui fait foi est celui du
 * serveur (supabase/migrations/…_jeu_expansion.sql), et un test vérifie que les deux s'accordent.
 */
import defaults from "../../../config/conquete.json" with { type: "json" };

export type ConquestConfig = typeof defaults;
export type Terrain = keyof ConquestConfig["terrain"];

export const DEFAULT_CONFIG: ConquestConfig = defaults;

export const TERRAIN_LABELS: Record<Terrain, string> = { plains: "Plaine", highland: "Colline", mountain: "Montagne" };

/**
 * `maxTroops` d'OpenFront : `2 × (tuiles^0,6 × 1000 + 50 000) + villes`.
 * Un territoire vaut 100 tuiles, et les capsules données prennent la place des villes.
 */
export function capacity(territories: number, capsules: number, c: ConquestConfig = DEFAULT_CONFIG): number {
  const { multiplier, tilesExponent, tilesFactor, base, capsuleFactor, capsuleExponent } = c.capacity;
  return multiplier * (Math.pow(territories * c.tilesPerTerritory, tilesExponent) * tilesFactor + base) + capsuleFactor * Math.pow(Math.max(capsules, 0), capsuleExponent);
}

/** `troopIncreaseRate` d'OpenFront : un pas toutes les 100 ms dans le jeu, toutes les heures ici. */
export function regenStep(troops: number, cap: number, c: ConquestConfig = DEFAULT_CONFIG): number {
  return (c.regen.base + Math.pow(Math.max(troops, 0), c.regen.exponent) / c.regen.divisor) * (1 - troops / cap);
}

/** Au-delà de ce nombre de pas, on s'arrête : la réserve est de toute façon à l'équilibre. */
export const MAX_STEPS = 5000;

/** La réserve après un certain temps, comme le calcule le serveur. */
export function settle(troops: number, elapsedMs: number, cap: number, c: ConquestConfig = DEFAULT_CONFIG): { troops: number; steps: number } {
  const steps = Math.floor(elapsedMs / (c.regen.tickMinutes * 60_000));
  if (steps <= 0) return { troops, steps: 0 };
  let t = troops;
  for (let i = 0; i < Math.min(steps, MAX_STEPS); i++) t = Math.max(0, t + regenStep(t, cap, c));
  return { troops: Math.floor(t), steps };
}

/** Sans territoire et sans capsule : 25 000 troupes, le départ d'une partie d'OpenFront. */
export const startingTroops = (capsules: number, c: ConquestConfig = DEFAULT_CONFIG): number => nearest(c.startShare * capacity(0, capsules, c));

/**
 * Un don fait pendant la saison arrive en renfort : 100 troupes par capsule, la vraie règle de la carte
 * du clan. La capacité reste le plafond : un très gros don remplit la réserve, sans la dépasser.
 */
export function donationTroops(capsules: number, troops: number, cap: number, c: ConquestConfig = DEFAULT_CONFIG): number {
  return Math.min(Math.floor(Math.max(capsules, 0) * c.troopsPerCapsule), Math.max(Math.floor(cap) - troops, 0));
}

/** Prendre une terre libre : `mag ÷ 5` par tuile, comme contre la « terra nullius » d'OpenFront. */
export const neutralCost = (terrain: Terrain, c: ConquestConfig = DEFAULT_CONFIG): number => Math.ceil((c.terrain[terrain] / c.neutralDivisor) * c.tilesPerTerritory);

export interface AttackResult {
  won: boolean;
  /** Garnison ÷ troupes envoyées, borné comme dans `attackLogic`. */
  ratio: number;
  losses: number;
  /** Les troupes qui tiennent le territoire après une victoire. */
  survivors: number;
  /** La garnison après le combat, quel qu'en soit le vainqueur. */
  garrisonAfter: number;
}

/**
 * `attackLogic` d'OpenFront, additionné sur les tuiles du territoire :
 * `mag × rapport × (0,463 × tuiles + 5 × 0,0039 × garnison)`.
 * Le ×5 est le bonus du poste de défense : toute garnison est retranchée.
 * En cas d'échec, la garnison perd la part du territoire que l'attaque aurait prise.
 */
export function resolveAttack(sent: number, garrison: number, terrain: Terrain, c: ConquestConfig = DEFAULT_CONFIG): AttackResult {
  const { ratioMin, ratioMax, lossBase, lossDensity, garrisonBonus } = c.combat;
  const ratio = Math.min(Math.max(garrison / sent, ratioMin), ratioMax);
  const losses = c.terrain[terrain] * ratio * (lossBase * c.tilesPerTerritory + garrisonBonus * lossDensity * garrison);
  if (losses < sent) {
    const survivors = Math.max(1, nearest(sent - losses));
    return { won: true, ratio, losses, survivors, garrisonAfter: survivors };
  }
  return { won: false, ratio, losses, survivors: 0, garrisonAfter: Math.max(1, nearest(garrison * (1 - sent / losses))) };
}

/** Arrondi au plus proche, le même ici et sur le serveur. */
export const nearest = (value: number): number => Math.floor(value + 0.5);

/** Le plus petit envoi qui gagne, pour l'indiquer au joueur. */
export function troopsToWin(garrison: number, terrain: Terrain, c: ConquestConfig = DEFAULT_CONFIG): number {
  let low = 1;
  let high = Math.max(garrison, 1000) * 64;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (resolveAttack(middle, garrison, terrain, c).won) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Deux joueurs à égalité partagent la même place. */
export function ranked<T>(rows: readonly T[], value: (row: T) => number): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((row, i) => {
    const v = value(row);
    if (v !== previous) rank = i + 1;
    previous = v;
    return { ...row, rank };
  });
}
