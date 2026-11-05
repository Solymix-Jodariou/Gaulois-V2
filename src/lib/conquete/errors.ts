/** Ce que disent les refus du serveur. Un test vérifie qu'aucun code du serveur n'est oublié. */
import { fmtDateTime, fmtInt } from "../format";

type Detail = Record<string, unknown> | null | undefined;

const until = (d: Detail) => (typeof d?.["until"] === "string" ? fmtDateTime(d["until"]) : "plus tard");
const num = (d: Detail, key: string) => fmtInt(typeof d?.[key] === "number" ? d[key] : null);

export const ERROR_MESSAGES: Record<string, string | ((detail: Detail) => string)> = {
  network: "Le jeu ne répond pas pour l'instant. Réessayez dans un moment.",
  not_signed_in: "Connectez-vous d'abord avec Discord.",
  not_validated: "Votre compte attend encore la validation d'un officier.",
  suspended: "Ce compte est suspendu.",
  forbidden: "Votre rôle ne permet pas cette action.",
  rate_limited: "Trop d'actions en une minute : patientez un instant.",
  invalid_request: "Cette demande n'est pas valable. Rechargez la page.",
  not_on_yourself: "Vous ne pouvez pas faire cela sur votre propre compte.",
  user_not_found: "Ce compte n'existe pas.",
  founder_exists: "Le clan a déjà un fondateur.",
  founder_cannot_leave: "Le fondateur doit d'abord transmettre son rôle : le clan ne peut pas rester sans fondateur.",
  target_not_validated: "Ce compte n'est pas validé.",
  target_not_suspended: "Ce compte n'est pas suspendu.",
  invalid_reason: "Indiquez une raison, en 300 caractères au plus.",
  invalid_note: "Le message ne doit pas dépasser 300 caractères.",

  roster_incomplete: "La liste des membres reçue est incomplète : elle n'a pas été prise en compte.",
  discord_required: "Connectez-vous avec Discord : c'est là qu'un officier vous reconnaît.",
  invalid_title: "Donnez un titre, en 120 caractères au plus.",
  invalid_body: "Écrivez un texte, en 2 000 caractères au plus.",
  invalid_url: "Le lien doit commencer par https:// et ne contenir aucune espace.",
  invalid_start: "Choisissez une date à venir.",
  news_not_found: "Cette publication n'existe plus.",
  already_validated: "Votre compte est déjà validé.",
  invalid_claim: "Indiquez votre pseudo OpenFront ou votre identifiant public.",
  request_open: "Vous avez déjà une demande en cours.",
  no_open_request: "Vous n'avez aucune demande en cours.",
  ambiguous_pseudo: "Plusieurs membres portent ce pseudo : indiquez plutôt votre identifiant public.",
  already_linked: "Ce joueur OpenFront est déjà lié à un compte. Parlez-en à un officier sur Discord.",
  request_not_found: "Cette demande n'existe plus.",
  request_closed: "Cette demande a déjà été traitée.",

  invalid_capsules: "Indiquez un nombre de capsules entier et positif.",
  invalid_date: "Cette date n'est pas valable.",
  invalid_screenshot: "Cette capture n'a pas pu être retrouvée. Envoyez-la de nouveau.",
  too_many_pending: "Vous avez déjà beaucoup de dons en attente : attendez qu'un officier les traite.",
  donation_not_found: "Ce don n'existe plus.",
  donation_closed: "Ce don a déjà été traité.",
  donations_synced: "Les dons sont maintenant lus directement chez OpenFront : il n'y a plus rien à déclarer ni à saisir ici.",

  no_active_season: "Aucune saison n'est en cours.",
  territory_not_found: "Ce territoire n'existe pas.",
  territory_taken: "Ce territoire vient d'être pris par quelqu'un.",
  territory_free: "Ce territoire est libre : il se conquiert, il ne s'attaque pas.",
  already_started: "Vous avez déjà un territoire.",
  excluded: "Vous avez été retiré de cette saison.",
  no_start: "Choisissez d'abord votre territoire de départ.",
  not_adjacent: "Ce territoire n'est pas voisin des vôtres.",
  not_your_territory: "Ce territoire n'est pas à vous.",
  own_territory: "Ce territoire est déjà à vous.",
  invalid_troops: "Indiquez un nombre de troupes entier et positif.",
  not_enough_troops: (d) => `Pas assez de troupes : il vous en reste ${num(d, "available")}.`,
  too_few_troops: (d) => `Il faut envoyer au moins ${num(d, "minimum")} troupes pour tenir ce territoire.`,
  expansion_limit: (d) => `Vous avez conquis vos ${num(d, "limit")} terres du jour. Revenez demain.`,
  not_war: "La guerre n'a pas encore commencé.",
  territory_protected: (d) => `Ce territoire est protégé jusqu'au ${until(d)}.`,
  last_territory: "C'est le dernier territoire de ce joueur : il ne peut pas être attaqué.",
  attack_limit: (d) => `Vous avez lancé vos ${num(d, "limit")} attaques du jour. Revenez demain.`,
  attack_cooldown: (d) => `Vos troupes se préparent : prochaine attaque possible le ${until(d)}.`,

  invalid_name: "Donnez un nom à la saison, en 60 caractères au plus.",
  invalid_config: (d) => `Réglage non valable : ${String(d?.["field"] ?? "")}.`,
  map_not_found: "Cette carte n'existe pas.",
  season_open: "Une saison est déjà ouverte : clôturez-la d'abord.",
  season_not_found: "Cette saison n'existe pas.",
  season_closed: "Cette saison est terminée.",
  season_not_draft: "Cette saison a déjà été lancée.",
  season_not_running: "Cette saison n'est pas en cours.",
  not_expansion: "La guerre a déjà commencé.",
  player_not_found: "Ce joueur n'est pas concerné dans la saison en cours.",
};

export function errorMessage(code: string, detail?: unknown): string {
  const entry = ERROR_MESSAGES[code];
  if (typeof entry === "function") return entry(detail as Detail);
  return entry ?? "Une erreur inattendue est survenue.";
}
