# [GAL] Les Gaulois

Site du clan OpenFront [GAL] : Astro statique sur GitHub Pages. La connexion, `/direction` et la Conquête des Gaulois s'appuient sur Supabase. Détails : `README.md` et `docs/` (`CONQUETE`, `REGLES_CONQUETE`, `DIRECTION`, `DESIGN`, `API_AUDIT`).

Vérifier : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

Les procédures sont dans `.claude/skills/` : `migration-supabase` (schéma, droits, formules, identité, vérification du vrai projet), `donnees-openfront` (API, CGU, carte des clans, reprise de fichiers OpenFront), `tests-e2e` (Playwright, ports, démo), `/publier` (avant tout push ou mise en ligne). `.claude/settings.json` bloque `git push`, `db push`, `git add -A` et la lecture de `.env` : c'est voulu.

Règles chargées selon les fichiers touchés, dans `.claude/rules/` : `frontend.md` (site, accessibilité, contenus), `conquete.md` (jeu, dons, carte), `deployment.md` (workflow, robot de données, secrets).

## Règles

- Répondre en français, en tutoyant. Rapporter les résultats sans embellir. La personne qui pilote le projet ne développe pas : expliquer simplement, une étape à la fois.
- Rien n'est poussé, publié ni déployé sans accord explicite, `npx supabase db push` compris. Un push sur `main` publie le site (`site.yml`). Prévisualiser avant de publier. Aucune dépense.
- Aucun secret dans ce dépôt public : ils restent côté serveur, `.env.example` est tenu à jour, `supabase/.temp/` reste ignoré. Les identifiants Discord de l'encadrement n'y entrent jamais. Pas de `git add -A` sans contrôle.
- Données : n'inventer aucune stat, aucun joueur, aucun résultat, aucun texte ni conseil de jeu du clan. Chiffres issus de l'API ou d'un calcul documenté. Afficher la date de mise à jour. « Pas de données » ≠ zéro. Pas d'historique présenté comme temps réel. Ne pas mélanger stats de clan et classé. Si l'API échoue : garder les dernières données valides et le signaler. Pas de classement recalculé. Un refus de l'API (403) ne se contourne pas.
- Stats membres : `stats.team` uniquement. `publicId` des anonymes jamais publié ; la base du jeu n'en garde que l'empreinte.
- Dons : jamais inventés. Aucun nom de donneur sans liste fournie par le clan (`content/carte-heros.json`). Ce qui n'est visible qu'aux membres n'entre pas ici : ni nom, ni montant exact. Seules les capsules comptent : ne jamais pousser vers le Plutonium, monnaie payante.
- Licences : le site est sous AGPL-3.0-only (`LICENSE`, `NOTICE.md`). Le code d'OpenFront (AGPL) et les fichiers de son dossier `resources/` (CC BY-SA 4.0 : cartes, images, données) peuvent être repris si la licence est respectée : origine, modification et date signalées dans le fichier, attribution « OpenFront » visible sur la page, ligne ajoutée au tableau de `NOTICE.md`. Même règle pour tout autre projet sous AGPL, comme TeamStats. Jamais : son dossier `proprietary/`, les assets de son CDN, son logo, ni une mise en page qui ferait passer le site pour officiel.
- Aucune référence à Astérix ni copie du site [FR]. Pas de marque Discord : texte seul sur le bouton.
- WCAG AA, `prefers-reduced-motion`, bouton pause obligatoire, pas de scroll horizontal (375–1920 px). Clic droit natif conservé sur liens, champs, texte sélectionné, Maj+clic. Les animations ne modifient jamais les valeurs.
- Ne pas reproposer l'ancien mini-jeu en temps réel : il a été rejeté et retiré.

## La Conquête

- Le serveur décide de tout : permissions et résultats se vérifient côté serveur, jamais en masquant un bouton. Le navigateur n'appelle que des fonctions SQL.
- Ne jamais se fier à `raw_user_meta_data` : il s'écrit depuis le navigateur, donc permet d'usurper le nom Discord et le rôle de fondateur. L'identité vient de `auth.identities`.
- Les CGU d'OpenFront (sections 5 et 6.5) interdisent robots et scripts : jamais de lecture automatique des dons, ni de session de joueur dans `OPENFRONT_DONATIONS_KEY`. Seule voie : un officier recopie la liste à la main dans `/admin` (détails dans la skill `donnees-openfront`).

## Pièges

- D'autres sessions tournent dans `.claude/worktrees/` : ne jamais arrêter de processus par filtre sur leur nom ou leur ligne de commande. Vérifier d'abord le port et le chemin.
- `.btn` écrase la classe `hidden` de Tailwind : masquer via un conteneur.
