/**
 * Lit la liste des dons qu'un officier a copiée à la main dans le jeu, puis collée dans /admin :
 * une ou plusieurs réponses à la suite, dans n'importe quel ordre.
 * Ce fichier tourne dans le navigateur : rien de Node ici. Le pseudo et l'identifiant du donneur
 * n'en sortent jamais. Voir « Les dons copiés à la main » dans docs/CONQUETE.md.
 */
import { z } from "zod";

/** Une réponse de `GET /clans/:tag/donations`. Le pseudo et la note ne sont jamais lus : zod les retire. */
export const ApiDonationsPage = z.object({
  results: z.array(
    z.object({
      id: z.string().regex(/^\d{1,40}$/),
      currencyType: z.string(),
      amount: z.string().regex(/^\d{1,18}$/),
      createdBy: z.string().nullable(),
      createdAt: z.iso.datetime({ offset: true }),
    }),
  ),
  total: z.number(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
});
type DonationsPage = z.infer<typeof ApiDonationsPage>;

export interface DonationRow {
  id: string;
  hash: string | null;
  capsules: number;
  at: string;
}

export interface PageProblem {
  /** Sa place dans le collage, à partir de 1. */
  position: number;
  /** Le numéro de page qu'elle annonce, s'il se lit encore. */
  page: number | null;
  reason: string;
}

export interface DonationImport {
  /** Les capsules à enregistrer, sans doublon. Du donneur ne reste qu'une empreinte. */
  rows: DonationRow[];
  /** Les réponses valables. */
  pages: number;
  /** Les dons différents lus, Plutonium compris, à comparer à `announced`. */
  read: number;
  /** Les lectures en trop d'un don déjà lu. */
  duplicates: number;
  problems: PageProblem[];
  /** Le nombre de dons annoncé par OpenFront, ou null si aucune page n'a pu être lue. */
  announced: number | null;
  /** Le nombre de dons en capsules qu'il faudrait connaître : `announced`, moins le Plutonium lu. */
  expected: number | null;
  /** Les pages à recoller : absentes ou illisibles. Vide si les pages n'ont pas toutes la même taille. */
  missingPages: number[];
  /** Tout ce qu'annonce OpenFront a été lu, même si un morceau de texte a été écarté à côté. */
  complete: boolean;
}

/** Le début d'une page. Impossible dans une chaîne JSON valide, où les guillemets sont échappés. */
const PAGE_START = /\{\s*"results"\s*:/g;
const PAGE_NUMBER = /"page"\s*:\s*(\d+)/;
const SEPARATOR = /[\s,[\]]/;
/** La même borne que la table `openfront_donations`. */
const MAX_CAPSULES = 1_000_000_000;

/** La fin de l'objet ouvert en `from`, ou null s'il n'est pas refermé avant `limit`. */
function objectEnd(text: string, from: number, limit: number): number | null {
  let depth = 0;
  let inString = false;
  for (let i = from; i < limit; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
  }
  return null;
}

/**
 * Découpe le collage en réponses. Le début de la page suivante borne toujours la recherche :
 * une page coupée, même au milieu d'une chaîne, n'entraîne pas les suivantes avec elle.
 */
function splitResponses(text: string): string[] {
  const starts = Array.from(text.matchAll(PAGE_START), (m) => m.index);
  const pieces: string[] = [];
  let at = 0;
  let next = 0;
  while (at < text.length) {
    if (SEPARATOR.test(text.charAt(at))) {
      at++;
      continue;
    }
    while (next < starts.length && starts[next]! <= at) next++;
    const limit = starts[next] ?? text.length;
    const end = text.charAt(at) === "{" ? (objectEnd(text, at, limit) ?? limit) : limit;
    pieces.push(text.slice(at, end));
    at = end;
  }
  return pieces;
}

function readPiece(piece: string): { page: DonationsPage } | { reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(piece);
  } catch {
    return { reason: piece.startsWith("{") ? "Réponse coupée ou abîmée : recopiez-la en entier." : "Ce texte n'est pas une réponse JSON." };
  }
  const parsed = ApiDonationsPage.safeParse(json);
  if (!parsed.success) return { reason: "Ce n'est pas une page de dons, ou l'un de ses dons a un format inattendu." };
  const impossible = parsed.data.results.some((d) => d.currencyType === "soft" && !(Number(d.amount) >= 1 && Number(d.amount) <= MAX_CAPSULES));
  return impossible ? { reason: "Un don de cette page a un montant impossible." } : { page: parsed.data };
}

function findMissingPages(pages: DonationsPage[], announced: number | null): number[] {
  const limits = new Set(pages.map((p) => p.limit));
  const [limit] = limits;
  if (announced === null || limits.size !== 1 || !limit) return [];
  const read = new Set(pages.map((p) => p.page));
  return Array.from({ length: Math.ceil(announced / limit) }, (_, i) => i + 1).filter((n) => !read.has(n));
}

/** La même empreinte que `hashPublicId` dans `job.ts`, qui ne peut pas tourner dans le navigateur. */
async function publicIdHash(publicId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicId));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Valide chaque réponse à part, puis fusionne celles qui sont bonnes en dédoublonnant par `id`.
 * Une réponse invalide est écartée entière et signalée, sans empêcher de lire les autres.
 * Seules les capsules sont gardées, comme dans `fetchDonations`.
 */
export async function readDonationPages(text: string): Promise<DonationImport> {
  const problems: PageProblem[] = [];
  const pages: DonationsPage[] = [];
  splitResponses(text).forEach((piece, i) => {
    const result = readPiece(piece);
    if ("page" in result) pages.push(result.page);
    else problems.push({ position: i + 1, page: Number(PAGE_NUMBER.exec(piece)?.[1]) || null, reason: result.reason });
  });

  const donations = pages.flatMap((p) => p.results);
  const unique = [...new Map(donations.map((d) => [d.id, d])).values()];
  const rows = await Promise.all(
    unique
      .filter((d) => d.currencyType === "soft")
      .map(async (d) => ({
        id: d.id,
        hash: d.createdBy === null ? null : await publicIdHash(d.createdBy),
        capsules: Number(d.amount),
        at: d.createdAt,
      })),
  );
  const announced = pages.length > 0 ? Math.max(...pages.map((p) => p.total)) : null;
  const missingPages = findMissingPages(pages, announced);
  return {
    rows,
    pages: pages.length,
    read: unique.length,
    duplicates: donations.length - unique.length,
    problems,
    announced,
    expected: announced === null ? null : Math.max(announced - (unique.length - rows.length), 0),
    missingPages,
    complete: announced !== null && unique.length >= announced && missingPages.length === 0,
  };
}
