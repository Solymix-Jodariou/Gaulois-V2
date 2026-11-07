# [GAL] Les Gaulois — site du clan

Site statique Astro du clan OpenFront [GAL], publié sur GitHub Pages : <https://les-gaulois.github.io/> (dépôt `les-gaulois/les-gaulois.github.io`, branche `main`). La GitHub Action `.github/workflows/site.yml` collecte l'API OpenFront toutes les heures dans `data/`, puis reconstruit et publie le site. Seuls la connexion Discord et l'espace Direction ont un serveur (Supabase). La Conquête des Gaulois, ancien jeu de territoires, a été retirée le 6 novembre 2026 : ne pas la reproposer, ne pas réutiliser son code ni `config/conquete.json`.

Détails : `README.md`, `docs/API_AUDIT.md` (API), `docs/DESIGN.md` (design), `docs/DIRECTION.md` (connexion, rôles, Supabase), `NOTICE.md` (licences).

## Autonomie : tu décides et tu publies

La personne qui pilote le projet ne développe pas et t'a confié le site en autonomie complète.

- Tu décides seul des choix techniques et de design, dans le cadre des règles ci-dessous. Tu ne demandes pas d'accord pour modifier, committer, pousser sur `main` ni mettre en ligne. Un push sur `main` publie le site : c'est voulu.
- Avant tout push : la procédure de la skill `publier`, qui commence par `verifier`. Rien ne part tant qu'un contrôle échoue.
- Tu ne t'arrêtes pour demander que dans ces cas : une dépense, quelle qu'elle soit ; la suppression de données du vrai projet Supabase ou de l'historique dans `data/` ; une migration qui supprime ou vide une table ou une colonne ; une action hors de ce dépôt (comptes GitHub, Supabase, Discord, cron-job.org) ; une question que ces règles ne tranchent pas. Alors : prépare tout, explique en une phrase ce qui bloque, et attends.
- Les sections « Données », « Secrets » et « Licences » ne se négocient pas. Si une demande les contredit, explique pourquoi et propose autre chose.
- En fin de tâche, rapporte en français simple, sans embellir : ce qui est fait, ce qui est en ligne, ce qui a échoué et pourquoi. Une étape à la fois, sans jargon inutile.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement, <http://localhost:4321> |
| `npm run build` | Images de marque, fichiers du film, puis `dist/` |
| `npm run preview -- --host 127.0.0.1 --port 4321` | Sert `dist/` (configuration `site-gal` de `.claude/launch.json`) |
| `npm run lint` · `npm run typecheck` · `npm test` | ESLint · `astro check` + `tsc` · Vitest |
| `npm run test:e2e` | Playwright sur `dist/` : après `npm run build` |
| `npm run data:fetch` · `npm run data:carte` | Collecte dans `data/` · seulement la carte des clans |
| `npm run verifier:ligne` | Contrôle le vrai projet Supabase sans rien écrire (variables à poser dans le shell) |

Node 22 ou plus. Sous Windows, le shell est Git Bash : chemins avec `/`.

## Carte du projet

- `config/clan.ts` : tag, nom, liens, logos, date de création du clan. Les champs à `null` ou `[]` masquent leur section.
- `src/pages/*.astro` : une page par fichier, mise en page `src/layouts/Base.astro` (en-tête, navigation, pied de page). Pages personnelles `compte`, `admin`, `direction` et fiches `membres/[id]` en `noindex`.
- `src/components/` : `.astro` statiques, `.tsx` Preact hydratés (`client:idle`, `client:visible` ou `client:only="preact"`). `src/components/compte/` : écrans de la connexion.
- `src/lib/` : calculs purs et testés. `schemas.ts` (Zod), `data.ts` (lecture de `data/` et `content/`), `compte/` (client Supabase `api.ts`, `preflight.ts`, `roster.ts`), `clanmap/` (carte des clans), `fx/` (logique des effets).
- `src/scripts/` : scripts navigateur — `fx.ts` effets, `film.ts` film de la carte, `conquest.ts` calculateur de la page Carte.
- `src/styles/global.css` : jetons de couleur et classes `.stage`, `.card`, `.btn-*`, `.wrap`.
- `content/` : textes du clan, JSON et Markdown (skill `contenu-clan`). `data/` : écrit par la collecte, jamais à la main.
- `scripts/` : collecte et outils Node (`tsx`). `supabase/migrations/` : schéma, figé une fois appliqué.
- `tests/unit/` Vitest ; `tests/e2e/` Playwright, `site.spec.ts` liste les pages contrôlées.
- `public/brand/` logos source, `public/generated/` dérivés (ignoré par Git), `public/carte-monde/` page HTML autonome.
- `.claude/worktrees/` : d'autres sessions y travaillent. Ne jamais arrêter un processus par son nom ou sa ligne de commande : vérifier le port et le chemin, puis arrêter ce processus-là seulement.

## Règles

### Données : rien d'inventé

- Aucune stat, aucun joueur, aucun résultat, aucun texte ni conseil de jeu inventé. Un chiffre vient de l'API ou d'un calcul documenté dans `src/lib/` et testé.
- Date de mise à jour visible. « Pas de données » n'est pas zéro. Pas d'historique présenté comme du temps réel. Pas de mélange entre stats de clan et classé. Pas de classement recalculé.
- Si l'API échoue : garder les dernières données valides et le signaler (`data/meta.json`). Un refus de l'API (403) ne se contourne pas.
- Stats des membres : `stats.team` uniquement. Le `publicId` d'un anonyme n'est jamais publié.
- Dons : aucun nom sans `content/carte-heros.json` fourni par le clan ; ni nom ni montant de ce qui n'est visible qu'aux membres ; seules les capsules comptent, jamais de renvoi vers le Plutonium, monnaie payante.
- Les conditions d'OpenFront (sections 5 et 6.5) interdisent robots et scripts : aucune lecture automatique de ce qui demande un compte de joueur.

### Secrets

- Dépôt public : aucun secret, jamais. `.env` reste local, `.env.example` est tenu à jour, `supabase/.temp/` reste ignoré. Les identifiants Discord de l'encadrement n'entrent jamais dans le dépôt.
- Jamais `git add -A`, `git add --all` ni `git add .` : ajouter les fichiers par leur nom et relire `git diff --cached` avant de committer.

### Licences

- Le site est sous AGPL-3.0-only (`LICENSE`, `NOTICE.md`). Le code d'OpenFront (AGPL) et son dossier `resources/` (CC BY-SA 4.0) se réutilisent seulement avec : origine, modification et date en tête du fichier, mention « © OpenFront and Contributors » visible, ligne ajoutée au tableau de `NOTICE.md`. Jamais : son dossier `proprietary/`, les assets de son CDN, son logo, ni une mise en page qui ferait passer le site pour officiel. Détail : skill `donnees-openfront`.
- Aucune référence à Astérix, pas de copie du site du clan [FR], pas de marque Discord : texte seul sur le bouton.

### Design et accessibilité

- Jetons, scènes et boutons de `docs/DESIGN.md` (skill `design-gal`). Aucune maquette ni valeur fictive dans l'interface.
- WCAG AA, `prefers-reduced-motion` respecté, bouton pause de l'en-tête obligatoire, aucun défilement horizontal de 360 à 1 920 px, clic droit natif conservé sur les liens, champs, texte sélectionné et avec Maj. Une animation ne change jamais une valeur.
- `.btn` écrase la classe `hidden` de Tailwind : masquer via un conteneur.

### Serveur Supabase

- Le serveur décide de tout : droits et résultats vérifiés en SQL, jamais en masquant un bouton. Le navigateur n'appelle que des fonctions SQL via `src/lib/compte/api.ts`.
- L'identité vient de `auth.identities`, jamais de `raw_user_meta_data`. Un compte sans Discord ne peut rien demander.
- Une migration appliquée ne se modifie jamais : on en ajoute une nouvelle. Détail et mise en ligne : skill `supabase`.

## Skills et sous-agent du projet

Dans `.claude/skills/` : `verifier` (tous les contrôles), `publier` (synchronisation, commit, push, suivi de l'Action, contrôle du site en ligne), `nouvelle-page`, `contenu-clan`, `design-gal`, `donnees-openfront`, `supabase`, `tests-e2e`. Le sous-agent `relecteur` (`.claude/agents/`) relit un changement avec un regard neuf avant publication.
