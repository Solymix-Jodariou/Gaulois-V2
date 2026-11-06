/**
 * La carte officielle. Sa taille vient de la documentation d'OpenFront.
 *
 * Sa surface de terre et le fond `data/clanmap/terrain.webp` viennent d'un seul relevé
 * de `/clanmap/terrain`, le 5 novembre 2026. Cette route n'est pas documentée et n'est
 * plus lue : voir docs/API_AUDIT.md, section 8.
 */
export const OFFICIAL_MAP = { width: 4108, height: 1948, land: 2_335_403 };
export const LAND_CHECKED_ON = "2026-11-05";

/** Pose les territoires sur le fond : même mélange que le lecteur du film. */
export function blendOwners(
  background: Uint8Array,
  owners: Uint16Array,
  colors: readonly ([number, number, number] | null)[],
): Uint8Array {
  const out = new Uint8Array(background);
  for (let c = 0; c < owners.length; c++) {
    const rgb = colors[owners[c]!];
    if (!rgb) continue;
    const o = c * 3;
    out[o] = rgb[0] * 0.85 + background[o]! * 0.15;
    out[o + 1] = rgb[1] * 0.85 + background[o + 1]! * 0.15;
    out[o + 2] = rgb[2] * 0.85 + background[o + 2]! * 0.15;
  }
  return out;
}
