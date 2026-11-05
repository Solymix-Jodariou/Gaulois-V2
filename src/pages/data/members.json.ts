import { loadMembers } from "../../lib/data";

/** Copie statique du fichier collecté, lue par le tableau des membres. Aucun appel à l'API OpenFront. */
export function GET() {
  const members = loadMembers() ?? { fetchedAt: new Date(0).toISOString(), total: 0, members: [] };
  return new Response(JSON.stringify(members), { headers: { "Content-Type": "application/json" } });
}
