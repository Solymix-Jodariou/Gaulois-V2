import { fmtInt } from "../format";
import type { FeedRow } from "./types";

const FORMER_MEMBER = "Un ancien membre";
const BUILT: Record<string, string> = { city: "une ville", port: "un port", post: "un poste de défense", sam: "une défense antiaérienne", silo: "un silo" };

const plural = (n: number | null, one: string, many: string) => `${fmtInt(n ?? 0)} ${(n ?? 0) > 1 ? many : one}`;
/** Une réserve déjà pleine ne reçoit rien : on le dit, plutôt qu'un « +0 » incompréhensible. */
const gain = (troops: number | null) => ((troops ?? 0) > 0 ? `+${plural(troops, "troupe", "troupes")} en renfort` : "sa réserve est déjà pleine");

/** Une ligne du fil d'actualité, en français. Aucun chiffre n'y est calculé : tout vient du serveur. */
export function feedText(e: FeedRow): string {
  const actor = e.actor ?? FORMER_MEMBER;
  const target = e.target ?? "un ancien membre";
  const territory = e.territory ?? "un territoire";
  switch (e.kind) {
    case "season_started":
      return "La saison commence : à vous de choisir votre terre.";
    case "war_started":
      return "La guerre commence : chaque territoire peut maintenant changer de main.";
    case "season_closed":
      return "La saison est terminée : le classement et la carte sont figés.";
    case "start":
      return `${actor} s'installe à ${territory}.`;
    case "expand":
      return `${actor} occupe ${territory}.`;
    case "attack_won":
      return `${actor} a pris ${territory} à ${target}.`;
    case "attack_lost":
      return `${actor} a échoué devant ${territory}, tenu par ${target}.`;
    case "player_excluded":
      return `${actor} a quitté la saison.`;
    case "donation":
      return `${e.actor ?? "Un membre anonyme"} offre ${plural(e.capsules, "capsule", "capsules")} au clan : ${gain(e.sent)}.`;
    case "donation_cancelled":
      return `Un don de ${plural(e.capsules, "capsule", "capsules")} a été annulé par un officier : ${plural(e.sent, "troupe repart", "troupes repartent")}.`;
    case "building":
      return `${actor} construit ${BUILT[e.detail ?? ""] ?? "un bâtiment"} à ${territory}.`;
    case "bomb":
      return `${actor} a bombardé ${territory}, tenu par ${target}.`;
    case "bomb_intercepted":
      return `La bombe de ${actor} sur ${territory} a été arrêtée par la défense de ${target}.`;
    case "alliance_made":
      return `${actor} et ${target} s'allient.`;
    case "alliance_broken":
      return `${actor} a trahi ${target} !`;
    case "victory":
      return `${actor} domine la carte et remporte la saison !`;
  }
}

/** Les chiffres d'un combat, pour qui veut les détails. */
export function feedDetail(e: FeedRow): string | null {
  if (e.kind === "bomb" && e.garrison_before !== null && e.garrison_after !== null) return `Garnison : de ${fmtInt(e.garrison_before)} à ${fmtInt(e.garrison_after)}.`;
  if (e.kind !== "attack_won" && e.kind !== "attack_lost") return null;
  if (e.sent === null || e.garrison_before === null || e.garrison_after === null) return null;
  const outcome = e.kind === "attack_won" ? `${fmtInt(e.garrison_after)} tiennent la place` : `garnison réduite à ${fmtInt(e.garrison_after)}`;
  return `${fmtInt(e.sent)} troupes contre ${fmtInt(e.garrison_before)} : ${outcome}.`;
}

/** Une couleur par joueur, bien répartie sur le cercle des teintes, toujours la même pour un numéro. */
export function playerColor(number: number): string {
  return `hsl(${hueOf(number)} 72% 58%)`;
}

/** Le contour de ses terres : la même teinte, plus sombre. */
export function playerBorder(number: number): string {
  return `hsl(${hueOf(number)} 80% 28%)`;
}

const hueOf = (number: number) => ((number * 137.508) % 360).toFixed(1);
