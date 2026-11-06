/**
 * Croissance des troupes dans OpenFront, pour le graphique du chapitre 2 de /debuter.
 * Formule du jeu : `troopIncreaseRate` dans packages/engine-lib/src/configuration/Config.ts (v0.35.12).
 * Elle vaut pour un joueur humain : les Bots et les Nations ont d'autres coefficients.
 */

/** Une capacité courante en partie : au-delà de 100 000, la forme de la courbe ne bouge presque plus. */
export const GROWTH_REFERENCE_CAPACITY = 1_000_000;

/** Troupes gagnées à chaque tick (100 ms). */
export function troopGainPerTick(troops: number, capacity: number): number {
  if (!(capacity > 0) || !(troops >= 0) || troops > capacity) return 0;
  return (10 + troops ** 0.73 / 4) * (1 - troops / capacity);
}

/** Remplissage de la capacité où le gain est le plus fort, en pour cent, au dixième près. */
export function peakPercent(capacity: number): number {
  let best = 0;
  let bestGain = -1;
  for (let tenths = 1; tenths < 1000; tenths++) {
    const gain = troopGainPerTick((capacity * tenths) / 1000, capacity);
    if (gain > bestGain) {
      bestGain = gain;
      best = tenths;
    }
  }
  return best / 10;
}

/** Gain à un remplissage donné, en pour cent du gain maximal pour cette capacité. */
export function gainVersusPeak(percent: number, capacity: number): number {
  const peak = troopGainPerTick((capacity * peakPercent(capacity)) / 100, capacity);
  return peak > 0 ? (troopGainPerTick((capacity * percent) / 100, capacity) / peak) * 100 : 0;
}
