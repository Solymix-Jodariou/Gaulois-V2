import { existsSync } from "node:fs";
import { join } from "node:path";
import { clan } from "../../config/clan";

const EXTENSIONS = ["svg", "webp", "png", "jpg", "jpeg"];

/** Chemin relatif à `public/` du logo demandé, ou `null` s'il n'a pas encore été déposé. */
export function brandFile(kind: keyof typeof clan.brand): string | null {
  for (const ext of EXTENSIONS) {
    const rel = `brand/${clan.brand[kind]}.${ext}`;
    if (existsSync(join(process.cwd(), "public", rel))) return rel;
  }
  return null;
}
