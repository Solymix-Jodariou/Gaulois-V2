/**
 * Prépare le film de la carte pour le site, dans public/generated/carte/ :
 * les données compressées, le fond de carte et une image de la carte finale,
 * affichée sans JavaScript et avant le chargement du film.
 * Sans film collecté, rien n'est généré et la page affiche « Pas de données ».
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { clanRgb, decodeFrames } from "../src/lib/clanmap/codec";
import { blendOwners } from "../src/lib/clanmap/terrain";
import { StoredClanMapFilm } from "../src/lib/schemas";

const source = join("data", "clanmap");
const out = join("public", "generated", "carte");
rmSync(out, { recursive: true, force: true });

const paths = { json: join(source, "film.json"), bin: join(source, "film.bin"), terrain: join(source, "terrain.webp") };
if (!existsSync(paths.json) || !existsSync(paths.bin) || !existsSync(paths.terrain)) {
  console.log("Carte : aucun film collecté, page sans film.");
  process.exit(0);
}

const json = readFileSync(paths.json, "utf8");
const film = StoredClanMapFilm.parse(JSON.parse(json));
const bin = readFileSync(paths.bin);
// Un film incohérent arrête le build : mieux vaut le site précédent qu'un film faux.
const frames = decodeFrames(bin, film.frames.length, film.totalChanges);

const owners = new Uint16Array(film.cols * film.rows);
for (let i = 0; i < frames.cells.length; i++) owners[frames.cells[i]!] = frames.owners[i]!;

const background = await sharp(paths.terrain).removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (background.info.width !== film.cols || background.info.height !== film.rows) {
  throw new Error(`Fond de carte de ${background.info.width} × ${background.info.height} pour ${film.cols} × ${film.rows} attendus.`);
}
const colors = film.clans.map((c, i) => (i === 0 ? null : clanRgb(c.color)));
const finale = blendOwners(background.data, owners, colors);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "film.json"), json);
writeFileSync(join(out, "film.bin.gz"), gzipSync(bin, { level: 9 }));
copyFileSync(paths.terrain, join(out, "terrain.webp"));
for (const width of [800, 1400]) {
  await sharp(finale, { raw: { width: film.cols, height: film.rows, channels: 3 } })
    .resize({ width })
    .webp({ quality: 80 })
    .toFile(join(out, `finale-${width}.webp`));
}
console.log(`Carte : film de ${film.frames.length} images, ${film.events} événements.`);
