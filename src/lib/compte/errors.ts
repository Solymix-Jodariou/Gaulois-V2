/** Ce que disent les refus du serveur. Un test vérifie qu'aucun code des comptes et de la Direction n'est oublié. */
export const ERROR_MESSAGES: Record<string, string> = {
  network: "Le serveur ne répond pas pour l'instant. Réessayez dans un moment.",
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
};

export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Une erreur inattendue est survenue.";
}
