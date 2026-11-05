/**
 * Format binaire du film de la carte, partagé entre la collecte et le navigateur.
 *
 * Pour chaque image : le nombre de cases modifiées, puis pour chaque case l'écart
 * avec la case précédente et l'index du clan, en entiers de taille variable.
 * Le fichier reste non compressé dans Git : les images déjà écrites ne changent
 * pas d'un jour à l'autre, donc Git ne stocke presque que les nouvelles.
 */

export interface DecodedFrames {
  /** `offsets[i]` : première modification de l'image `i`. Contient une entrée de plus que d'images. */
  offsets: Uint32Array;
  cells: Uint32Array;
  owners: Uint16Array;
}

/** `deltas` : pour chaque image, une liste plate `[case, clan, case, clan…]`, cases en ordre croissant. */
export function encodeFrames(deltas: readonly (readonly number[])[]): Uint8Array {
  let out = new Uint8Array(1 << 16);
  let n = 0;
  const write = (value: number) => {
    if (n + 10 > out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    let v = value;
    while (v > 127) {
      out[n++] = (v & 127) | 128;
      v = Math.floor(v / 128);
    }
    out[n++] = v;
  };
  for (const frame of deltas) {
    write(frame.length / 2);
    let last = 0;
    for (let k = 0; k < frame.length; k += 2) {
      const cell = frame[k]!;
      if (cell < last) throw new Error("cases non triées");
      write(cell - last);
      last = cell;
      write(frame[k + 1]!);
    }
  }
  return out.slice(0, n);
}

export function decodeFrames(bytes: Uint8Array, frameCount: number, totalChanges: number): DecodedFrames {
  const offsets = new Uint32Array(frameCount + 1);
  const cells = new Uint32Array(totalChanges);
  const owners = new Uint16Array(totalChanges);
  let p = 0;
  let n = 0;
  const read = () => {
    let v = 0;
    let m = 1;
    let b: number;
    do {
      if (p >= bytes.length) throw new Error("film tronqué");
      b = bytes[p++]!;
      v += (b & 127) * m;
      m *= 128;
    } while (b & 128);
    return v;
  };
  for (let f = 0; f < frameCount; f++) {
    const count = read();
    offsets[f] = n;
    if (n + count > totalChanges) throw new Error("film plus long que prévu");
    let last = 0;
    for (let k = 0; k < count; k++) {
      last += read();
      cells[n] = last;
      owners[n] = read();
      n++;
    }
  }
  offsets[frameCount] = n;
  if (n !== totalChanges || p !== bytes.length) throw new Error("film incohérent");
  return { offsets, cells, owners };
}

/** Couleur du jeu (`0xRRGGBB`). Un clan sans couleur connue est affiché en gris. */
export function clanRgb(color: number | null): [number, number, number] {
  if (color === null) return [130, 135, 150];
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}
