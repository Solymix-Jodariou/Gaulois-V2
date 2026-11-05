/**
 * Fond de carte du film, tiré du terrain servi par OpenFront.
 * Chaque case vaut un octet : bit 7 = terre, bits 0 à 4 = relief.
 */
const LAND = 128;
const RELIEF = 31;

export function countLand(terrain: Uint8Array): number {
  let land = 0;
  for (let i = 0; i < terrain.length; i++) if (terrain[i]! & LAND) land++;
  return land;
}

/** Une couleur sombre et discrète par case réduite, pour laisser ressortir les clans. */
export function terrainToRgb(terrain: Uint8Array, width: number, height: number, scale: number) {
  const cols = Math.floor(width / scale);
  const rows = Math.floor(height / scale);
  const data = new Uint8Array(cols * rows * 3);
  const half = scale * scale;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let land = 0;
      let relief = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const t = terrain[(cy * scale + dy) * width + cx * scale + dx]!;
          if (t & LAND) {
            land++;
            relief += t & RELIEF;
          }
        }
      }
      const o = (cy * cols + cx) * 3;
      if (land * 2 >= half) {
        const l = 34 + (relief / land) * 1.5;
        data[o] = l;
        data[o + 1] = l + 4;
        data[o + 2] = l + 2;
      } else if (land > 0) {
        data[o] = 28;
        data[o + 1] = 44;
        data[o + 2] = 66;
      } else {
        data[o] = 9;
        data[o + 1] = 20;
        data[o + 2] = 38;
      }
    }
  }
  return { data, width: cols, height: rows };
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
