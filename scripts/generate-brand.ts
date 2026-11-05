/**
 * Génère le favicon et l'image de partage dans public/generated/.
 * Sources : le badge rond et la bannière de public/brand/. Tant qu'ils ne sont
 * pas déposés, un visuel typographique provisoire les remplace.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { brandFile } from "../src/lib/brand";

const out = join("public", "generated");
mkdirSync(out, { recursive: true });

const NAVY = "#0A1230";

const fallbackIcon = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="32" fill="${NAVY}"/>
  <path d="M10 44A26 26 0 0 1 20 10" fill="none" stroke="#0B5FFF" stroke-width="6"/>
  <path d="M24 8.500A26 26 0 0 1 40 8.500" fill="none" stroke="#fff" stroke-width="6"/>
  <path d="M44 10A26 26 0 0 1 54 44" fill="none" stroke="#FF1A2E" stroke-width="6"/>
  <text x="32" y="44" font-family="Arial, sans-serif" font-weight="900" font-size="34" fill="#fff" text-anchor="middle">G</text>
</svg>`);

const fallbackOg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${NAVY}"/>
  <text x="600" y="320" font-family="Arial, sans-serif" font-weight="900" font-size="190" fill="#fff" text-anchor="middle">[GAL]</text>
  <text x="600" y="400" font-family="Arial, sans-serif" font-weight="700" font-size="52" letter-spacing="12" fill="#fff" text-anchor="middle">LES GAULOIS</text>
  <rect x="420" y="440" width="115" height="10" rx="3" fill="#0B5FFF"/>
  <rect x="542" y="440" width="115" height="10" rx="3" fill="#fff"/>
  <rect x="664" y="440" width="115" height="10" rx="3" fill="#FF1A2E"/>
</svg>`);

const circleMask = (size: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`,
  );

const badge = brandFile("badge");
const banner = brandFile("banner");

async function icon(size: number, name: string): Promise<void> {
  const image = badge ? sharp(join("public", badge), { density: 300 }).trim() : sharp(fallbackIcon, { density: 300 });
  await image
    .resize(size, size, { fit: "cover" })
    .composite([{ input: circleMask(size), blend: "dest-in" }])
    .png()
    .toFile(join(out, name));
}

await icon(32, "favicon-32.png");
await icon(180, "apple-touch-icon.png");
await icon(192, "icon-192.png");

// Versions légères affichées sur le site : les originaux pèsent jusqu'à 2 Mo.
if (badge) {
  await sharp(join("public", badge)).trim().resize(96, 96, { fit: "cover" }).webp({ quality: 90 }).toFile(join(out, "badge-96.webp"));
}
const vertical = brandFile("vertical");
if (vertical) {
  await sharp(join("public", vertical)).trim().resize(720, 720, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toFile(join(out, "logo-vertical-720.webp"));
}
if (banner) {
  for (const width of [800, 1600]) {
    await sharp(join("public", banner)).resize({ width }).webp({ quality: 82 }).toFile(join(out, `banner-${width}.webp`));
  }
}

await sharp(banner ? join("public", banner) : fallbackOg, { density: 150 })
  .resize(1200, 630, { fit: "cover" })
  .flatten({ background: NAVY })
  .jpeg({ quality: 85 })
  .toFile(join(out, "og.jpg"));

console.log(banner ? "Image de partage : bannière." : "Image de partage : visuel provisoire (bannière absente).");
console.log(badge ? "Favicon : badge." : "Favicon : visuel provisoire (badge absent).");
