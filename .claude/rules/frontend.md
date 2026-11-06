---
paths:
  - "src/pages/**"
  - "src/components/**"
  - "src/layouts/**"
  - "src/styles/**"
  - "src/scripts/**"
  - "src/lib/fx/**"
  - "src/lib/format.ts"
  - "content/**"
  - "public/brand/**"
  - "config/clan.ts"
  - "astro.config.mjs"
  - "docs/DESIGN.md"
  - "tests/e2e/**"
---

# Site : Astro, design, accessibilité, contenus

Astro statique, îlots Preact, Tailwind 4, polices Inter et Outfit servies par le site. Intention, jetons de couleur, scènes, boutons, animations et états des données : `docs/DESIGN.md` ; jetons dans `src/styles/global.css`. Le jeu reprend les boutons, cartes et couleurs du site, sans nouvelle identité.

## Accessibilité et écrans

- WCAG AA : lien d'évitement, focus visible, tout au clavier, contrastes (le bleu `blue` ne sert qu'au bouton principal, les liens prennent `blue-text`, pas de texte blanc sur le rouge vif). Les capitales viennent du CSS : le texte source reste en casse normale.
- `prefers-reduced-motion` respecté et bouton pause de l'en-tête obligatoire (WCAG 2.2.2). Les effets sont décoratifs : aucune information n'en dépend, un effet ne masque jamais du contenu, et une animation ne modifie jamais une valeur (une barre ne change pas de hauteur au survol). Sans JavaScript, tout s'affiche.
- Pas de défilement horizontal de 375 à 1 920 px ; tests à 360, 375, 768, 1 024, 1 280 et 1 920 px. Les tests headless n'ont pas de barre de défilement (15 px) : mesurer aussi dans le navigateur intégré.
- Clic droit natif conservé sur liens, boutons, champs, images autres que le logo et texte sélectionné ; Maj + clic droit l'ouvre partout.
- Les chiffres qui défilent sont masqués aux lecteurs d'écran, qui reçoivent la valeur finale. Graphiques doublés d'un tableau, jamais de double axe, identité jamais portée par la seule couleur.

## Affichage des données

- « Pas de données », jamais un zéro ; zéro réel : « 0 » ; taux sans partie : « — » ; hors classement : un texte, jamais un rang 0. Collecte en erreur ou données périmées : message jaune (`warn`), dernières données valides conservées, date de mise à jour affichée. Le mot « direct » n'apparaît nulle part.
- Les panneaux des scènes n'affichent que des données collectées : aucune maquette, aucune valeur fictive. Stats membres : `stats.team`, comme la page Membres.

## Contenus

- `content/*.json`, `content/guide/`, `content/guide-clan/` se modifient depuis GitHub ; formats dans `README.md`. Un JSON invalide est ignoré et signalé au build. Aucun texte ni conseil de jeu inventé.
- `content/guide/` est adapté du wiki OpenFront (CC BY-SA 4.0) : garder sa mention sous la section, réécrire plutôt que copier ; quand wiki et PDF du clan divergent, le code public du jeu tranche. Le graphique de croissance vient de `src/lib/growth.ts`, pas d'un texte.
- Le guide de `/debuter` a été publié le 06/11/2026 sur décision du clan, malgré la mention « document interne » des PDF : ne pas reposer la question. Le reste de `content/` est réservé au clan (`NOTICE.md`).
- Donateurs : `content/carte-heros.json`, recopié à la main par le clan s'il choisit de publier ; vide, la page n'affiche aucun nom et renvoie vers le jeu.
- Pas de référence à Astérix, pas de copie du site [FR], pas de marque Discord : texte seul sur le bouton. Mentions à garder visibles : « site non officiel », « © OpenFront and Contributors » (`config/clan.ts`), source et licence du fond de carte sur la page Carte.

## Pièges

- `.btn` écrase la classe `hidden` de Tailwind : masquer via un conteneur.
- Juste après une publication, une page gardée par le navigateur s'affiche sans style : GitHub Pages garde les pages 10 min et chaque publication supprime les anciens `_astro/`. Vérifier dans une fenêtre neuve, puis Ctrl + F5 ; ce n'est pas une panne.
- Bouton de lecture de la carte : il tient dans le premier écran sous 1 200 px ; une correction pour 1 280 × 600 a été refusée le 06/11/2026, ne pas la reproposer.
- Logos : `public/brand/` sous des noms fixes, originaux dans `brand-sources/` (non publiés), versions légères générées dans `public/generated/`.
