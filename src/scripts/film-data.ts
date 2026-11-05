/** Charge une seule fois les fichiers du film, partagés par le lecteur et le calculateur. */
import { decodeFrames, type DecodedFrames } from "../lib/clanmap/codec";
import type { StoredClanMapFilm } from "../lib/schemas";

export interface FilmData {
  film: StoredClanMapFilm;
  frames: DecodedFrames;
  terrain: HTMLImageElement;
}

async function load(assets: string): Promise<FilmData> {
  const [meta, bin] = await Promise.all([fetch(`${assets}film.json`), fetch(`${assets}film.bin.gz`)]);
  if (!meta.ok || !bin.ok) throw new Error("fichiers du film absents");
  const film = (await meta.json()) as StoredClanMapFilm;
  let bytes = new Uint8Array(await bin.arrayBuffer());
  // Un hébergeur peut avoir déjà décompressé le fichier en route.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const frames = decodeFrames(bytes, film.frames.length, film.totalChanges);
  const terrain = new Image();
  terrain.src = `${assets}terrain.webp`;
  await terrain.decode();
  return { film, frames, terrain };
}

let pending: Promise<FilmData> | null = null;

export function loadFilmData(assets: string): Promise<FilmData> {
  pending ??= load(assets).catch((e) => {
    // Un nouvel essai reste possible après un échec.
    pending = null;
    throw e;
  });
  return pending;
}
