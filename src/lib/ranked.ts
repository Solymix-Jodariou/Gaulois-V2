import type { ApiRankedPage, RankedMode, StoredMember, StoredRanked } from "./schemas";

export const RANKED_MODES: readonly { key: RankedMode; label: string }[] = [
  { key: "1v1", label: "1v1" },
  { key: "2v2", label: "2v2" },
  { key: "ffa", label: "FFA" },
];

/** Le « haut du classement » du second décompte de chaque mode. */
export const RANKED_TOP = 10;

/**
 * Par mode classé : combien de membres avec pseudo figurent dans le classement.
 * Aucun nom ni chiffre individuel n'en sort : les stats publiées d'un membre restent `stats.team`.
 * Le roster stocké n'a pas l'identifiant des anonymes : ces nombres sont donc des minimums.
 */
export function rankedCounts(pages: readonly ApiRankedPage[], members: readonly StoredMember[], fetchedAt: string): StoredRanked {
  const known = new Set(members.flatMap((m) => (m.publicId ? [m.publicId] : [])));
  const mode = (key: RankedMode) => {
    // Les pages sont lues l'une après l'autre : un joueur qui change de place entre-temps peut figurer sur les deux.
    const best = new Map<string, number>();
    for (const page of pages) {
      for (const { public_id: id, rank } of page[key]) {
        const seen = best.get(id);
        if (seen === undefined || rank < seen) best.set(id, rank);
      }
    }
    const ours = [...best].filter(([id]) => known.has(id));
    return { listed: best.size, members: ours.length, top: ours.filter(([, rank]) => rank <= RANKED_TOP).length };
  };
  return { fetchedAt, modes: { "1v1": mode("1v1"), "2v2": mode("2v2"), ffa: mode("ffa") } };
}
