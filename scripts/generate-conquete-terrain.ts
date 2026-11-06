/**
 * Génère le fond de la carte de la Conquête : une carte de jeu, dessinée en aplats de couleurs.
 * Natural Earth (domaine public) ne sert que de données : où sont les côtes, les déserts, les forêts
 * et les montagnes. Rien de son image ne reste à l'écran.
 * Se lance à la main : `npm run conquete:terrain`. Les images produites sont versionnées.
 *
 * Écrit public/conquete/terrain-<version>.webp, et une version légère pour les petits écrans.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { equalEarth, equalEarthInverse, smoothNoise, WORLD_VIEW } from "../src/lib/conquete/geo";

const VERSION = "v1";
const CACHE = ".cache/natural-earth";
const RASTER_URL = "https://naciscdn.org/naturalearth/50m/raster/HYP_50M_SR.zip";
const VECTOR_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
/** Pixels de l'image pour une unité de la carte. */
const PIXELS_PER_UNIT = 8;

type RGB = readonly [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/* ---------- La palette : les seules couleurs de la carte ---------- */

const enum Biome {
  Ice,
  Tundra,
  Taiga,
  Forest,
  Jungle,
  Grass,
  Steppe,
  Desert,
  Badlands,
  Plateau,
  Rock,
  Snow,
}
const BIOMES = 12;
const LAND: readonly RGB[] = [
  hex("#e4eef3"), // Glace
  hex("#b4c6a4"), // Toundra
  hex("#4c9270"), // Taïga
  hex("#62a862"), // Forêt
  hex("#3f9455"), // Jungle
  hex("#93c56a"), // Prairie
  hex("#c9c673"), // Steppe
  hex("#efd593"), // Désert
  hex("#dcab6c"), // Terres rouges
  hex("#bcae94"), // Haut plateau
  hex("#a08d79"), // Roche
  hex("#f6f4ee"), // Neiges
];
/**
 * La mer, en bandes, du large vers la côte. Chaque bande est la terre adoucie (`sigma`, en unités de la carte),
 * coupée à un seuil : les contours suivent les continents, et un îlot perdu n'y fait qu'une petite tache.
 */
const OPEN_SEA = hex("#123c69");
const SEA: readonly { color: RGB; sigma: number; above: number }[] = [
  { color: hex("#16477a"), sigma: 13, above: 0.13 },
  { color: hex("#1b5a8c"), sigma: 6, above: 0.15 },
  { color: hex("#23729f"), sigma: 2.6, above: 0.17 },
  { color: hex("#3190b3"), sigma: 1, above: 0.22 },
];
const FOAM = hex("#bfe9ec");
const BEACH = hex("#f5e7b5");

/* ---------- Les données sources ---------- */

async function download(url: string, path: string) {
  if (existsSync(path)) return;
  console.log(`Téléchargement de ${url}…`);
  const res = await fetch(url, { headers: { "User-Agent": "GAL-clan-site/1.0" } });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

function unzip(zip: string, into: string) {
  mkdirSync(into, { recursive: true });
  try {
    execFileSync("unzip", ["-oq", zip, "-d", into], { stdio: "ignore" });
  } catch {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${into}'`], { stdio: "inherit" });
  }
}

interface Feature {
  geometry: { type: string; coordinates: unknown };
}
async function ringsOf(name: string): Promise<number[][][]> {
  const path = join(CACHE, `${name}.geojson`);
  await download(`${VECTOR_URL}/${name}.geojson`, path);
  const features = (JSON.parse(readFileSync(path, "utf8")) as { features: Feature[] }).features;
  return features.flatMap(({ geometry: { type, coordinates } }) => (type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : []) as number[][][][]).flat();
}

mkdirSync(CACHE, { recursive: true });
const zipDir = join(CACHE, "raster-zip");
const rasterDir = join(CACHE, "raster");
mkdirSync(zipDir, { recursive: true });
const tif = join(rasterDir, "HYP_50M_SR.tif");
if (!existsSync(tif)) {
  const zip = join(zipDir, "HYP_50M_SR.zip");
  await download(RASTER_URL, zip);
  unzip(zip, rasterDir);
}

const width = Math.round((WORLD_VIEW.maxX - WORLD_VIEW.minX) * PIXELS_PER_UNIT);
const height = Math.round((WORLD_VIEW.maxY - WORLD_VIEW.minY) * PIXELS_PER_UNIT);
const count = width * height;
const viewBox = `${WORLD_VIEW.minX} ${WORLD_VIEW.minY} ${WORLD_VIEW.maxX - WORLD_VIEW.minX} ${WORLD_VIEW.maxY - WORLD_VIEW.minY}`;
/** Adoucit une image d'un seul canal. Sans les deux dernières étapes, sharp la rendrait en trois canaux. */
const blurred = (raw: Buffer, sigma: number, w = width, h = height) => sharp(raw, { raw: { width: w, height: h, channels: 1 }, limitInputPixels: false }).blur(sigma).toColourspace("b-w").extractChannel(0).raw().toBuffer();

/* ---------- Les terres et les lacs, à la taille de l'image ---------- */

const pathOf = (rings: number[][][]) =>
  rings
    .map((ring) => {
      const points = ring.map(([lon, lat]) => {
        const [x, y] = equalEarth(lon!, lat!);
        return `${(x * 100).toFixed(3)} ${(-y * 100).toFixed(3)}`;
      });
      return `M${points.join("L")}Z`;
    })
    .join("");
const [landRings, lakeRings] = await Promise.all([ringsOf("ne_50m_land"), ringsOf("ne_50m_lakes")]);
const rasterize = (svg: string) => sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true }).flatten({ background: "#000" }).toColourspace("b-w").extractChannel(0).raw().toBuffer();
const mask = await rasterize(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"><rect x="${WORLD_VIEW.minX}" y="${WORLD_VIEW.minY}" width="100%" height="100%" fill="#000"/><path fill="#fff" fill-rule="evenodd" d="${pathOf(landRings)}"/><path fill="#000" fill-rule="evenodd" d="${pathOf(lakeRings)}"/></svg>`,
);

/** Les méridiens et les parallèles : une discrète touche d'atlas sur la mer. */
const graticule = (() => {
  const lines: string[] = [];
  const line = (points: (readonly [number, number])[]) => `M${points.map(([x, y]) => `${(x * 100).toFixed(2)} ${(-y * 100).toFixed(2)}`).join("L")}`;
  for (let lon = -180; lon <= 180; lon += 30) lines.push(line(Array.from({ length: 73 }, (_, i) => equalEarth(lon, -90 + i * 2.5))));
  for (let lat = -60; lat <= 60; lat += 30) lines.push(line(Array.from({ length: 145 }, (_, i) => equalEarth(-180 + i * 2.5, lat))));
  return lines.join("");
})();
const graticuleMask = await rasterize(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"><rect x="${WORLD_VIEW.minX}" y="${WORLD_VIEW.minY}" width="100%" height="100%" fill="#000"/><path fill="none" stroke="#fff" stroke-width="0.16" d="${graticule}"/></svg>`,
);

/** La distance au bord, en unités de la carte, pour tous les pixels où `inside` est vrai. */
function distanceField(inside: (i: number) => boolean): Float32Array {
  const d = new Float32Array(count);
  for (let i = 0; i < count; i++) d[i] = inside(i) ? 1e6 : 0;
  const DIAGONAL = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      let best = d[i]!;
      if (x > 0) best = Math.min(best, d[i - 1]! + 1);
      if (y > 0) {
        best = Math.min(best, d[i - width]! + 1);
        if (x > 0) best = Math.min(best, d[i - width - 1]! + DIAGONAL);
        if (x < width - 1) best = Math.min(best, d[i - width + 1]! + DIAGONAL);
      }
      d[i] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      let best = d[i]!;
      if (x < width - 1) best = Math.min(best, d[i + 1]! + 1);
      if (y < height - 1) {
        best = Math.min(best, d[i + width]! + 1);
        if (x > 0) best = Math.min(best, d[i + width - 1]! + DIAGONAL);
        if (x < width - 1) best = Math.min(best, d[i + width + 1]! + DIAGONAL);
      }
      d[i] = best;
    }
  }
  for (let i = 0; i < count; i++) d[i] = d[i]! / PIXELS_PER_UNIT;
  return d;
}
const toCoast = distanceField((i) => mask[i]! < 128);
const fromCoast = distanceField((i) => mask[i]! >= 128);

// L'ombre que la terre porte sur la mer, vers le bas à droite : la carte prend du volume, comme découpée.
const SHADOW_X = Math.round(PIXELS_PER_UNIT * 0.3);
const SHADOW_Y = Math.round(PIXELS_PER_UNIT * 0.42);
const shifted = Buffer.alloc(count);
for (let y = SHADOW_Y; y < height; y++) mask.copy(shifted, y * width + SHADOW_X, (y - SHADOW_Y) * width, (y - SHADOW_Y) * width + width - SHADOW_X);
const shadow = await blurred(shifted, PIXELS_PER_UNIT * 0.28);
const shelves = await Promise.all(SEA.map(({ sigma }) => blurred(mask, PIXELS_PER_UNIT * sigma)));

/* ---------- Les biomes, déduits de la source ---------- */

const SOURCE_W = 5400;
const SOURCE_H = 2700;
const sourceColour = await sharp(tif, { limitInputPixels: false, unlimited: true }).removeAlpha().resize(SOURCE_W, SOURCE_H, { fit: "fill" }).blur(4).raw().toBuffer();
const sourceLuma = await sharp(tif, { limitInputPixels: false, unlimited: true }).removeAlpha().resize(SOURCE_W, SOURCE_H, { fit: "fill" }).greyscale().toColourspace("b-w").extractChannel(0).raw().toBuffer();
const lumaSoft = await blurred(sourceLuma, 9, SOURCE_W, SOURCE_H);
const contrast = Buffer.alloc(SOURCE_W * SOURCE_H);
for (let i = 0; i < contrast.length; i++) contrast[i] = Math.min(255, Math.abs(sourceLuma[i]! - lumaSoft[i]!) * 4);
const rugged = await blurred(contrast, 7, SOURCE_W, SOURCE_H);

const biomeOf = (r: number, g: number, b: number, rough: number, lon: number, lat: number): Biome => {
  const light = (r + g + b) / 3;
  const green = g - r;
  // Une latitude un peu déformée : le climat ne suit jamais une ligne droite.
  const north = Math.abs(lat) + smoothNoise(lon / 17, lat / 17, 21) * 5.5 + smoothNoise(lon / 5, lat / 5, 22) * 1.8;
  if (light > 226 || (north > 64 && light > 212)) return Biome.Ice;
  if (rough > 92) return light > 204 ? Biome.Snow : Biome.Rock;
  if (light > 192 && Math.abs(r - b) < 18 && rough > 18) return Biome.Plateau;
  if (north > 67 && green > -12) return Biome.Tundra;
  if (north > 56 && green > -12) return Biome.Taiga;
  if (green >= 12) {
    if (north < 24) return green >= 22 ? Biome.Jungle : Biome.Grass;
    return green >= 30 ? Biome.Forest : Biome.Grass;
  }
  if (green >= -7) return Biome.Steppe;
  return green < -16 ? Biome.Badlands : Biome.Desert;
};

const biomes = new Uint8Array(count).fill(255);
/** Le relief de la source, gardé sur trois niveaux seulement : de l'ombre et de la lumière, pas une photo. */
const facets = new Int8Array(count);
const roughness = new Uint8Array(count);
for (let row = 0; row < height; row++) {
  const my = WORLD_VIEW.minY + (row + 0.5) / PIXELS_PER_UNIT;
  for (let col = 0; col < width; col++) {
    const i = row * width + col;
    if (mask[i]! === 0) continue;
    const mx = WORLD_VIEW.minX + (col + 0.5) / PIXELS_PER_UNIT;
    const [lon, lat] = equalEarthInverse(mx / 100, -my / 100);
    if (Math.abs(lon) > 180) continue;
    const sx = Math.min(SOURCE_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * SOURCE_W)));
    const sy = Math.min(SOURCE_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * SOURCE_H)));
    const s = sy * SOURCE_W + sx;
    const rough = rugged[s]!;
    biomes[i] = biomeOf(sourceColour[s * 3]!, sourceColour[s * 3 + 1]!, sourceColour[s * 3 + 2]!, rough, lon, lat);
    roughness[i] = rough;
    const relief = sourceLuma[s]! - lumaSoft[s]!;
    if (rough > 34) facets[i] = relief > 7 ? 1 : relief < -7 ? -1 : 0;
  }
}

// Chaque biome est adouci à part, puis le plus présent l'emporte : des zones nettes, aux bords naturels.
const score = new Float32Array(count).fill(-1);
const smooth = new Uint8Array(count).fill(255);
for (let biome = 0; biome < BIOMES; biome++) {
  const layer = Buffer.alloc(count);
  for (let i = 0; i < count; i++) if (biomes[i] === biome) layer[i] = 255;
  const soft = await blurred(layer, PIXELS_PER_UNIT * 0.42);
  for (let i = 0; i < count; i++) {
    if (mask[i]! > 0 && soft[i]! > score[i]!) {
      score[i] = soft[i]!;
      smooth[i] = biome;
    }
  }
}
const facetLayer = Buffer.alloc(count);
for (let i = 0; i < count; i++) facetLayer[i] = 128 + facets[i]! * 127;
const facetSoft = await blurred(facetLayer, PIXELS_PER_UNIT * 0.1);

/* ---------- Le dessin ---------- */

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const edge = (from: number, to: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

const out = Buffer.alloc(count * 3);
for (let row = 0; row < height; row++) {
  const my = WORLD_VIEW.minY + (row + 0.5) / PIXELS_PER_UNIT;
  for (let col = 0; col < width; col++) {
    const i = row * width + col;
    const mx = WORLD_VIEW.minX + (col + 0.5) / PIXELS_PER_UNIT;
    const coverage = mask[i]! / 255;

    /* La mer : des bandes franches, avec un petit fondu au bord pour ne pas être crénelées au zoom. */
    const wobble = smoothNoise(mx / 3.2, my / 3.2, 3) * 0.018 + smoothNoise(mx / 1.2, my / 1.2, 4) * 0.008;
    let sea = OPEN_SEA;
    SEA.forEach(({ color, above }, band) => {
      const value = shelves[band]![i]! / 255 + wobble;
      sea = mix(sea, color, edge(above - 0.006, above + 0.006, value));
    });
    sea = mix(sea, [255, 255, 255], (graticuleMask[i]! / 255) * 0.07);
    sea = scale(sea, 1 - (shadow[i]! / 255) * 0.34);
    sea = mix(sea, FOAM, (1 - edge(0, 0.2, toCoast[i]!)) * 0.85);

    let color: RGB = sea;
    if (coverage > 0) {
      const biome = smooth[i] === 255 ? Biome.Grass : smooth[i]!;
      let ground = LAND[biome]!;
      // Deux tons par zone, en larges plaques : une carte peinte, pas un aplat de tableur.
      const patch = smoothNoise(mx / 4.2, my / 4.2, 7) * 0.7 + smoothNoise(mx / 1.5, my / 1.5, 8) * 0.3;
      ground = scale(ground, patch > 0.16 ? 1.035 : patch < -0.16 ? 0.965 : 1);
      // La lumière vient d'en haut à gauche : trois niveaux suffisent à faire lire les montagnes.
      const facet = (facetSoft[i]! - 128) / 127;
      if (facet > 0.25) ground = scale(ground, 1 + 0.07 * edge(0.25, 0.7, facet));
      else if (facet < -0.25) ground = scale(ground, 1 - 0.14 * edge(0.25, 0.7, -facet));
      // Un liseré de plage au sud, une côte simplement plus claire dans le froid.
      const shore = 1 - edge(0.04, 0.3, fromCoast[i]!);
      const cold = biome === Biome.Ice || biome === Biome.Snow || biome === Biome.Tundra || biome === Biome.Taiga;
      ground = cold ? mix(ground, [255, 255, 255], shore * 0.16) : mix(ground, BEACH, shore * 0.55);
      color = mix(sea, ground, coverage);
    }
    const o = i * 3;
    out[o] = Math.max(0, Math.min(255, Math.round(color[0])));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(color[1])));
    out[o + 2] = Math.max(0, Math.min(255, Math.round(color[2])));
  }
}

mkdirSync("public/conquete", { recursive: true });
const image = sharp(out, { raw: { width, height, channels: 3 }, limitInputPixels: false });
const full = await image.clone().webp({ quality: 80, effort: 6, smartSubsample: true }).toBuffer();
const small = await image.clone().resize(Math.round(width * 0.41)).webp({ quality: 76, effort: 6, smartSubsample: true }).toBuffer();
writeFileSync(`public/conquete/terrain-${VERSION}.webp`, full);
writeFileSync(`public/conquete/terrain-${VERSION}-small.webp`, small);
console.log(`Terrain : ${width} × ${height} px, ${Math.round(full.length / 1024)} Ko ; version légère ${Math.round(small.length / 1024)} Ko.`);
