/**
 * Configuration du clan. Seules les valeurs confirmées sont renseignées.
 * `null` ou `[]` signifie « à remplir » : la section correspondante reste
 * masquée sur le site tant que le clan n'a pas fourni le contenu.
 */
export const clan = {
  tag: "GAL",
  name: "Les Gaulois",
  tagline: "Le clan français [GAL] sur OpenFront.",

  // Texte de la fiche du clan dans le jeu, relevé le 5 novembre 2026, sans l'emoji ni le lien.
  description: "Clan francophone actif, vocal obligatoire pour jouer avec notre TAG en équipe, sur Discord !" as
    | string
    | null,

  // À remplir par le clan.
  history: null as string | null,
  values: [] as string[],
  entryConditions: [] as string[],

  links: {
    discord: "https://discord.gg/cjUc42T7Y2",
    openfront: "https://openfront.io/",
    source: "https://github.com/Solymix-Jodariou/Gaulois-V2",
  },

  /**
   * Noms de base des fichiers de `public/brand/`, sans extension.
   * Formats reconnus : .svg, .webp, .png, .jpg, .jpeg.
   */
  brand: {
    banner: "banner",
    horizontal: "logo-horizontal",
    badge: "badge",
    vertical: "logo-vertical",
  },

  /**
   * Fiche du clan constatée dans le jeu le 5 novembre 2026 (voir
   * docs/API_AUDIT.md). À remettre à jour si le clan change de statut.
   */
  join: {
    inviteOnly: true,
    checkedOn: "2026-11-05",
  },

  /**
   * Date de création du clan selon le jeu. Les sessions sont archivées et la
   * progression affichée à partir de ce jour : les parties antérieures portent
   * le même tag, mais rien ne prouve qu'il s'agissait du même groupe.
   */
  archiveStart: "2026-04-10",
} as const;

export const SITE_DISCLAIMER =
  "Site communautaire non officiel, sans lien avec les éditeurs d'OpenFront.";

/** Exigée par l'AGPL et par les conditions d'OpenFront : voir NOTICE.md. Elle doit rester visible. */
export const SITE_LICENSE_NOTICE =
  "Code sous licence AGPL-3.0. Certaines parties sont adaptées d'OpenFront, © OpenFront and Contributors.";
