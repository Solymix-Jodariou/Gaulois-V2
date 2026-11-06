/**
 * Ce que le joueur doit apprendre sans aller lire le fil : ce qui le touche, lui, et les grands moments
 * de la saison. Rien n'y est calculé : tout vient des événements du serveur.
 */
import { fmtInt } from "../format";
import { feedText } from "./feed";
import type { FeedRow } from "./types";

export type NoticeTone = "danger" | "good" | "info";

export interface Notice {
  id: number;
  tone: NoticeTone;
  text: string;
  /** Une mauvaise nouvelle attend qu'on l'ait lue : elle ne s'efface pas toute seule. */
  sticky: boolean;
  /** Elle concerne ce joueur-là, et pas seulement la partie. */
  personal: boolean;
  territoryId: number | null;
}

const notice = (e: FeedRow, tone: NoticeTone, text: string, personal: boolean): Notice => ({ id: e.id, tone, text, sticky: tone === "danger", personal, territoryId: e.territory_id });

/** L'annonce d'un événement pour ce joueur, ou rien s'il n'en a pas besoin. */
export function noticeFor(e: FeedRow, me: number | null): Notice | null {
  const targetIsMe = me !== null && e.target_number === me;
  const actorIsMe = me !== null && e.actor_number === me;
  const actor = e.actor ?? "Un ancien membre";
  const territory = e.territory ?? "un territoire";
  switch (e.kind) {
    case "attack_won":
      return targetIsMe ? notice(e, "danger", `${actor} vous a pris ${territory}.`, true) : null;
    case "attack_lost":
      return targetIsMe ? notice(e, "good", `${actor} a échoué devant ${territory} : votre garnison tombe à ${fmtInt(e.garrison_after)}.`, true) : null;
    case "bomb":
      return targetIsMe ? notice(e, "danger", `${actor} a bombardé ${territory} : votre garnison passe de ${fmtInt(e.garrison_before)} à ${fmtInt(e.garrison_after)}.`, true) : null;
    case "bomb_intercepted":
      return targetIsMe ? notice(e, "good", `Votre défense a arrêté la bombe de ${actor} sur ${territory}.`, true) : null;
    case "alliance_made":
      if (targetIsMe) return notice(e, "good", `Vous êtes maintenant allié à ${actor}.`, true);
      return actorIsMe ? notice(e, "good", `Vous êtes maintenant allié à ${e.target ?? "un ancien membre"}.`, true) : null;
    case "alliance_broken":
      return targetIsMe ? notice(e, "danger", `${actor} a rompu votre alliance : pour un temps, l'attaquer vous coûte moitié moins.`, true) : null;
    case "donation_cancelled":
      return actorIsMe ? notice(e, "danger", feedText(e), true) : null;
    case "war_started":
    case "victory":
      return notice(e, "info", feedText(e), false);
    case "donation":
      return notice(e, "info", feedText(e), actorIsMe);
    default:
      return null;
  }
}

/** Au retour d'une absence, seuls comptent ce qui vous touche et le début de la guerre. */
const mattersAfterAbsence = (n: Notice, e: FeedRow) => n.personal || e.kind === "war_started";

export const MAX_NOTICES = 3;

/**
 * Les annonces des événements arrivés depuis `since`, les plus récentes d'abord.
 * `away` : le joueur revient, et ne verra pas les dons des autres de ces dernières heures.
 */
export function newNotices(rows: readonly FeedRow[], me: number | null, since: number, away: boolean): { shown: Notice[]; more: number } {
  const all: Notice[] = [];
  for (const e of rows) {
    if (e.id <= since) continue;
    const n = noticeFor(e, me);
    if (n && (!away || mattersAfterAbsence(n, e))) all.push(n);
  }
  return { shown: all.slice(0, MAX_NOTICES), more: Math.max(0, all.length - MAX_NOTICES) };
}
