/**
 * La carte officielle. Sa taille vient de la documentation d'OpenFront.
 *
 * Son terrain est « Giant World Map », une carte du dépôt public du jeu sous CC BY-SA 4.0,
 * avec l'attribution « OpenFront ». Sa surface de terre vient du manifeste de cette carte,
 * et le fond `data/clanmap/terrain.webp` en est une version réduite et assombrie.
 * Voir docs/API_AUDIT.md, section 8.
 */
export const OFFICIAL_MAP = { width: 4108, height: 1948, land: 2_335_403 };

/** Le fichier du terrain, fixé à un commit. Chaque case vaut un octet : bit 7 = terre, bits 0 à 4 = relief. */
export const TERRAIN_ORIGIN = "https://raw.githubusercontent.com";
export const TERRAIN_PATH = "/openfrontio/OpenFrontIO/641e462b0b980b9cad8faff2e9f89d8caac44c4f/resources/maps/giantworldmap/map.bin";

export const LAND = 128;

export function countLand(terrain: Uint8Array): number {
  let land = 0;
  for (let i = 0; i < terrain.length; i++) if (terrain[i]! & LAND) land++;
  return land;
}

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
