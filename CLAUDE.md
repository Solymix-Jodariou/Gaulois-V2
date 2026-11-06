# [GAL] Les Gaulois

Site du clan OpenFront [GAL] : Astro statique sur GitHub Pages. La connexion, `/direction` et la Conquête des Gaulois s'appuient sur Supabase. Détails : `README.md` et `docs/` (`CONQUETE`, `REGLES_CONQUETE`, `DIRECTION`, `DESIGN`, `API_AUDIT`).

Vérifier : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

## Règles

- Répondre en français, en tutoyant. Rapporter les résultats sans embellir. La personne qui pilote le projet ne développe pas : expliquer simplement, une étape à la fois.
- Rien n'est poussé, publié ni déployé sans accord explicite, `npx supabase db push` compris. Prévisualiser avant de publier. Aucune dépense.
- Aucun secret dans ce dépôt public : ils restent côté serveur, `.env.example` est tenu à jour, `supabase/.temp/` reste ignoré. Pas de `git add -A` sans contrôle.
- Données : n'inventer aucune stat, aucun joueur, aucun résultat, aucun texte ni conseil de jeu du clan. Chiffres issus de l'API ou d'un calcul documenté. Afficher la date de mise à jour. « Pas de données » ≠ zéro. Pas d'historique présenté comme temps réel. Ne pas mélanger stats de clan et classé. Si l'API échoue : garder les dernières données valides et le signaler. Pas de classement recalculé.
- Stats membres : `stats.team` uniquement. `publicId` des anonymes jamais publié ; la base du jeu n'en garde que l'empreinte.
- Dons : jamais inventés. Aucun nom de donneur sans liste fournie par le clan (`content/carte-heros.json`). Ce qui n'est visible qu'aux membres n'entre pas ici : ni nom, ni montant exact. Seules les capsules comptent : ne jamais pousser vers le Plutonium, monnaie payante.
- Aucune référence à Astérix ni copie du site [FR]. Pas de marque Discord : texte seul sur le bouton.
- WCAG AA, `prefers-reduced-motion`, bouton pause obligatoire, pas de scroll horizontal (375–1920 px). Clic droit natif conservé sur liens, champs, texte sélectionné, Maj+clic. Les animations ne modifient jamais les valeurs.
- Ne pas reproposer l'ancien mini-jeu en temps réel : il a été rejeté et retiré.

## La Conquête

- Le serveur décide de tout : permissions et résultats se vérifient côté serveur, jamais en masquant un bouton. Le navigateur n'appelle que des fonctions SQL.
- Une formule reste identique dans `src/lib/conquete/rules.ts` et en SQL (`tests/db/formules.test.ts`). Un réglage ajouté va aussi dans `internal.config_problem` et `src/lib/conquete/config-labels.ts`. Toute écriture SQL garde un `WHERE` : Supabase le refuse sinon.
- Ne jamais se fier à `raw_user_meta_data` : il s'écrit depuis le navigateur, donc permet d'usurper le nom Discord et le rôle de fondateur. L'identité vient de `auth.identities`.
- Le premier fondateur fait sa demande dans `/compte` avant `bootstrap_founder`, puis la valide lui-même dans `/admin`. Un compte déjà validé ne peut plus en faire : il resterait « Gaulois n° … », sans lien OpenFront (`tests/db/direction.test.ts`).
- L'encadrement se prévoit par SQL (`internal.role_presets`, voir `docs/DIRECTION.md`) : ses identifiants Discord n'entrent jamais dans ce dépôt public.
- Les migrations sont figées : `db push` ne rejoue jamais une migration appliquée, donc en ajouter une au lieu d'en modifier une. Le vrai projet est en Postgres 17, les tests en 18.
- Postgres ouvre toute fonction nouvelle à tout le monde, visiteurs compris, et `…_droits.sql` ne ferme que celles créées avant lui. La migration qui crée une fonction fait donc elle-même `revoke all … from public, anon, authenticated` puis ses `grant` : `tests/db/comptes.test.ts` échoue si un visiteur peut l'appeler.
- Supabase ouvre aussi toute nouvelle table de `public` à `anon` et `authenticated` (`pg_default_acl`) : la migration qui la crée active RLS et fait `revoke all … from anon, authenticated`.
- Les conditions d'OpenFront (sections 5 et 6.5) interdisent les robots et les scripts : jamais de lecture automatique des dons, ni de session de joueur dans `OPENFRONT_DONATIONS_KEY`, qui n'attend qu'une clé donnée par OpenFront. Seule exception, décidée le 06/11/2026 sans attendre son accord : un officier recopie la liste à la main et la colle dans `/admin`. Rien n'automatise cette copie, et ses vraies réponses n'entrent jamais dans ce dépôt, tests compris. Si OpenFront s'y oppose, elle s'arrête.
- Le code d'OpenFront est sous AGPL et ses images sous CC BY-SA : reprendre les mécaniques, tout réécrire, sans ses images, couleurs ni mise en page exacte.
- Sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY`, le jeu reste fermé. Ne poser ces variables GitHub qu'une fois le schéma installé et le site publié à jour.
- Contrôler le vrai projet sans rien écrire : `npx supabase db query --remote=zxavwcupauheheqxfdez --read-only -f fichier.sql` et `npx supabase config diff --remote=zxavwcupauheheqxfdez`.

## Pièges

- Un push sur `main` publie le site (`site.yml`) et peut aussi partir sur Railway, dont le rôle n'est pas établi.
- Le robot de données pousse toutes les heures. La tâche « Collecte GAL » de cron-job.org lance le workflow à la minute 53, avec un jeton GitHub réservé à cette tâche ; le créneau de GitHub, souvent retardé ou sauté, sert de secours. Avant un push, intégrer `origin/main`, garder ses données et le bloc `clanmap` de `data/meta.json`, vérifier `data/history/` : Git peut y garder une vieille version sans signaler de conflit.
- D'autres sessions tournent dans `.claude/worktrees/` : ne jamais arrêter de processus par filtre sur leur nom ou leur ligne de commande. Vérifier d'abord le port et le chemin.
- La carte ne lit que `/public/clanmap/history` et le terrain public du jeu (`resources/maps/giantworldmap/map.bin`, CC BY-SA : garder sur la page sa source et sa licence), plus `/clans/GAL` pour le trésor. `/clanmap/ownership` est refusée aux machines de GitHub (403) : ne pas contourner ce refus, et ne pas relire `/clanmap/*` sans accord d'OpenFront (section 5 de ses conditions).
- Tests e2e : Playwright réutilise ce qui écoute sur 4321, parfois une vieille version, et veut 4322 et 54399 libres, donc arrêter d'abord sa démo. `Get-NetTCPConnection -State Listen` peut les dire libres alors qu'ils répondent : tenter une vraie connexion. 4321 et 4322 sont en dur dans `playwright.config.ts` : pour en changer, adapter une copie de la config et exporter `GAL_TEST_SITE_PORT` et `GAL_TEST_SUPABASE_PORT` dans le shell, car la pile et les tests les lisent aussi. Une seconde pile dans le même dossier écrase `dist-conquete/`.
- Sous charge, un test du jeu peut dépasser 30 s : le relancer seul avant de conclure.
- `.btn` écrase la classe `hidden` de Tailwind : masquer via un conteneur.
- Réutiliser le code de TeamStats imposerait l'AGPL, et la licence du dépôt n'est pas tranchée.
