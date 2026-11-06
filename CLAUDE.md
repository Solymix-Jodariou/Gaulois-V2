# [GAL] Les Gaulois

Site du clan OpenFront [GAL] : Astro statique sur GitHub Pages, données collectées toutes les heures par une GitHub Action dans `data/` ; les visiteurs n'appellent jamais l'API. Seule la Conquête des Gaulois (connexion Discord, `/compte`, `/admin`, `/direction`, jeu) a un serveur, Supabase, appelé par fonctions SQL. Détails : `README.md`, `NOTICE.md`, `docs/`.

## Communication

Français, tutoiement. La personne qui pilote le projet ne développe pas : expliquer simplement, une étape à la fois, avec le texte exact à saisir et ce qu'elle doit voir. Rapporter sans embellir : vérifié ou non vérifié. Ne jamais lui demander de coller un secret dans la discussion.

## Sans accord explicite, jamais

- Pousser, publier, déployer, écrire sur le vrai Supabase (`npx supabase db push` compris), engager une dépense. Un push sur `main` publie le site. Prévisualiser avant de publier. Un accord vaut pour une action, pas pour les suivantes.
- Mettre un secret dans ce dépôt public : ils restent côté serveur, `.env.example` est tenu à jour, `supabase/.temp/` reste ignoré, pas de `git add -A` sans contrôle.
- Arrêter un processus par filtre sur son nom ou sa ligne de commande : d'autres sessions Claude tournent dans `.claude/worktrees/`. Vérifier d'abord le port et le chemin ; n'écraser le travail d'aucune autre session.

## Données, dons et droit

- N'inventer aucune stat, aucun joueur, aucun résultat, aucun texte ni conseil de jeu du clan. Chiffres issus de l'API ou d'un calcul documenté, avec leur date de mise à jour. « Pas de données » ≠ zéro. Pas de classement recalculé, pas de mélange entre stats de clan et classé, pas d'historique présenté comme du direct. Si l'API échoue : garder les dernières données valides et le dire. Stats membres : `stats.team` seul.
- Dons : jamais inventés. Aucun nom de donneur sans liste fournie par le clan (`content/carte-heros.json`) ; ni nom ni montant visibles aux seuls membres. Seules les capsules comptent : ne jamais pousser vers le Plutonium, monnaie payante.
- `publicId` des membres anonymes jamais publié ; la base du jeu n'en garde qu'une empreinte. Identifiants Discord de l'encadrement jamais dans le dépôt.
- Conditions d'OpenFront (sections 5 et 6.5) : aucun robot, script, extension ni session de joueur pour lire ce qu'il réserve aux membres ou refuse aux machines. Seule exception décidée : la copie à la main des dons par un officier (`conquete.md`).
- Site sous AGPL-3.0-only : du code AGPL repris (OpenFront, TeamStats…) se signale et se date dans son fichier et s'ajoute à `NOTICE.md`. Jamais les images, cartes, couleurs ni mise en page d'OpenFront : le jeu reste original.

## Décisions figées

Pas d'Astérix, pas de copie du site [FR], pas de marque Discord (texte seul sur le bouton). L'ancien mini-jeu en temps réel a été rejeté et retiré le 05/11/2026 : ne pas le reproposer. Dans la Conquête, le serveur décide de tout : droits et résultats se vérifient en SQL, jamais en masquant un bouton.

## Méthode

- Partir des règles et de `docs/` ; lire les seuls fichiers utiles, une fois ; modifications ciblées ; pas de sous-agent sans besoin réel ; planifier avant de toucher plusieurs fichiers ; réponses courtes sans rien taire d'utile. Économiser le contexte ne justifie jamais de sauter une vérification ni d'affaiblir la sécurité.
- Avant de conclure : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` ; tests ciblés d'abord, suites complètes ensuite.

## Règles spécialisées : `.claude/rules/`

Chargées seules quand un fichier concerné est lu ou modifié ; à lire aussi avant l'action couverte :

- `supabase.md` : migrations, droits SQL, identité, vrai projet. Avant toute commande `supabase`.
- `conquete.md` : formules, réglages, dons, carte du jeu.
- `frontend.md` : Astro, design, accessibilité, animations, contenus.
- `openfront.md` : API, stats, carte des clans, licences, conditions.
- `tests.md` : Vitest, Playwright, ports, démo. Avant tests ou démo.
- `deployment.md` : workflow, robot de données, Railway. Avant tout push ou fusion de `origin/main`.
