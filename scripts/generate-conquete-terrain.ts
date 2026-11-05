/**
 * Génère le fond de la carte de la Conquête : le relief de Natural Earth (domaine public),
 * reprojeté en Equal Earth pour tomber exactement sous les hexagones, avec notre propre océan.
 * Se lance à la main : `npm run conquete:terrain`. Les images produites sont versionnées.
 *
 * Écrit public/conquete/terrain-<version>.webp, et une version légère pour les petits écrans.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { equalEarthInverse, equalEarth, WORLD_VIEW } from "../src/lib/conquete/geo";

const VERSION = "v1";
const CACHE = ".cache/natural-earth";
const RASTER_URL = "https://naciscdn.org/naturalearth/50m/raster/HYP_50M_SR.zip";
const VECTOR_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
/** Pixels de l'image pour une unité de la carte : assez fins pour un zoom ×3 sur un grand écran. */
const PIXELS_PER_UNIT = 6;

/** Notre mer : un bleu profond, plus clair près des côtes. */
const DEEP = [24, 66, 112] as const;
const SHORE = [58, 124, 168] as const;

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
const zip = join(zipDir, "HYP_50M_SR.zip");
await download(RASTER_URL, zip);
const tif = join(rasterDir, "HYP_50M_SR.tif");
if (!existsSync(tif)) unzip(zip, rasterDir);

const width = Math.round((WORLD_VIEW.maxX - WORLD_VIEW.minX) * PIXELS_PER_UNIT);
const height = Math.round((WORLD_VIEW.maxY - WORLD_VIEW.minY) * PIXELS_PER_UNIT);

/* ---------- Les terres et les lacs, dessinés à la taille de l'image ---------- */

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
const [land, lakes] = await Promise.all([ringsOf("ne_50m_land"), ringsOf("ne_50m_lakes")]);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${WORLD_VIEW.minX} ${WORLD_VIEW.minY} ${WORLD_VIEW.maxX - WORLD_VIEW.minX} ${WORLD_VIEW.maxY - WORLD_VIEW.minY}"><rect x="${WORLD_VIEW.minX}" y="${WORLD_VIEW.minY}" width="100%" height="100%" fill="#000"/><path fill="#fff" fill-rule="evenodd" d="${pathOf(land)}"/><path fill="#000" fill-rule="evenodd" d="${pathOf(lakes)}"/></svg>`;
const maskImage = sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true }).flatten({ background: "#000" }).toColourspace("b-w").extractChannel(0);
const mask = await maskImage.clone().raw().toBuffer();
// Plus on s'éloigne de la côte, plus la mer s'assombrit : deux halos, l'un étroit, l'autre large.
const near = await maskImage.clone().blur(PIXELS_PER_UNIT * 1.6).raw().toBuffer();
const far = await maskImage.clone().blur(PIXELS_PER_UNIT * 7).raw().toBuffer();

/* ---------- Le relief, reprojeté ---------- */

// Deux fois plus fin que l'image finale : assez pour rester net, sans scintiller.
const sourceWidth = 5400;
const sourceHeight = 2700;
const source = await sharp(tif, { limitInputPixels: false, unlimited: true }).removeAlpha().resize(sourceWidth, sourceHeight, { fit: "fill", kernel: "lanczos3" }).modulate({ saturation: 1.18, brightness: 1.04 }).raw().toBuffer();

const sample = (lon: number, lat: number, out: number[]) => {
  const fx = ((lon + 180) / 360) * sourceWidth - 0.5;
  const fy = ((90 - lat) / 180) * sourceHeight - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.max(0, Math.floor(fy));
  const y1 = Math.min(sourceHeight - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const left = (x0 + sourceWidth) % sourceWidth;
  const right = (x0 + 1 + sourceWidth) % sourceWidth;
  for (let c = 0; c < 3; c++) {
    const a = source[(y0 * sourceWidth + left) * 3 + c]!;
    const b = source[(y0 * sourceWidth + right) * 3 + c]!;
    const d = source[(y1 * sourceWidth + left) * 3 + c]!;
    const e = source[(y1 * sourceWidth + right) * 3 + c]!;
    out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
};

const out = Buffer.alloc(width * height * 3);
const pixel = [0, 0, 0];
for (let row = 0; row < height; row++) {
  const my = WORLD_VIEW.minY + (row + 0.5) / PIXELS_PER_UNIT;
  for (let col = 0; col < width; col++) {
    const i = row * width + col;
    const mx = WORLD_VIEW.minX + (col + 0.5) / PIXELS_PER_UNIT;
    const shore = Math.min(1, (near[i]! / 255) * 1.5 + (far[i]! / 255) * 0.9);
    const glow = Math.pow(shore, 0.8);
    const sea = [0, 1, 2].map((c) => DEEP[c]! + (SHORE[c]! - DEEP[c]!) * glow);
    const landShare = mask[i]! / 255;
    const position = landShare > 0 ? equalEarthInverse(mx / 100, -my / 100) : null;
    if (position && Math.abs(position[0]) <= 180) sample(position[0], position[1], pixel);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(position ? sea[c]! * (1 - landShare) + pixel[c]! * landShare : sea[c]!);
  }
}

mkdirSync("public/conquete", { recursive: true });
const image = sharp(out, { raw: { width, height, channels: 3 } });
const full = await image.clone().webp({ quality: 72, effort: 6, smartSubsample: true }).toBuffer();
const small = await image.clone().resize(Math.round(width * 0.55)).webp({ quality: 68, effort: 6, smartSubsample: true }).toBuffer();
writeFileSync(`public/conquete/terrain-${VERSION}.webp`, full);
writeFileSync(`public/conquete/terrain-${VERSION}-small.webp`, small);
console.log(`Terrain : ${width} × ${height} px, ${Math.round(full.length / 1024)} Ko ; version légère ${Math.round(small.length / 1024)} Ko.`);
