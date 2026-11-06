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

/** La teinte d'un joueur, en degrés : bien répartie sur le cercle, toujours la même pour un numéro. */
export const playerHue = (number: number): number => (number * 137.508) % 360;

/** Une couleur OKLCH, rendue en sRGB : toutes les teintes y ont la même clarté à l'œil, sans vert criard ni bleu éteint. */
function oklch(lightness: number, chroma: number, hue: number): string {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channel = (linear: number) => {
    const v = Math.max(0, Math.min(1, linear));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  };
  return `rgb(${channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)} ${channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)} ${channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)})`;
}

/** Une couleur par joueur. */
export function playerColor(number: number): string {
  return oklch(0.72, 0.17, playerHue(number));
}

/** Le contour de ses terres : la même teinte, plus sombre. */
export function playerBorder(number: number): string {
  return oklch(0.38, 0.12, playerHue(number));
}
