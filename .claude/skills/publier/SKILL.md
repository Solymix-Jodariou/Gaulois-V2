---
name: publier
description: Procédure avant tout push sur main ou toute mise en ligne (site, schéma Supabase, variables GitHub). À lancer avec /publier ; ne se déclenche jamais toute seule.
disable-model-invocation: true
---

# Publier

Rien n'est poussé, publié ni déployé sans accord explicite. Cette procédure prépare et vérifie ; le push attend un « oui » clair. `.claude/settings.json` bloque `git push` et `supabase db push` pour Claude : c'est voulu, la personne qui pilote les lance elle-même. Aucune dépense.

## Ce qui se passe au push

- Un push sur `main` lance `.github/workflows/site.yml` : collecte des données, `conquete:job`, tests, build, puis publication sur GitHub Pages (jobs `test-db`, `build`, `deploy`). Il peut aussi partir sur Railway, déploiement préexistant dont le rôle n'est pas établi.
- Le robot de données tourne aussi toutes les heures : la tâche « Collecte GAL » de cron-job.org lance le workflow à la minute 53, avec un jeton GitHub réservé à cette tâche ; le créneau planifié de GitHub (minute 23), souvent retardé ou sauté, sert de secours. Détails du robot, variables et secrets : `.claude/rules/deployment.md`.

## Avant un push sur `main`

1. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` : tout passe (voir la skill `tests-e2e` si besoin).
2. `git fetch` puis intégrer `origin/main` : il bouge souvent (robot, autres sessions). `sync_with_base_branch` peut échouer (« Committer identity unknown ») : fusionner à la main.
3. Garder ses données et le bloc `clanmap` de `data/meta.json`.
4. Vérifier `data/history/` : Git peut y garder une vieille version sans signaler de conflit. `film.bin` et les `.webp` sont binaires (`.gitattributes`).
5. Contrôler le diff fichier par fichier : pas de `git add -A`, aucun secret, `supabase/.temp/` et `.env` absents.
6. `npm run preview` et montrer le résultat avant de demander l'accord.
7. Lister ce qui va partir et demander l'accord. Sans « oui » explicite, rien ne part.

## Après la publication

- Vérifier le run dans l'onglet Actions (`gh` n'est pas installé : l'API publique de GitHub se lit sans lui), puis la page en ligne dans une fenêtre neuve : https://solymix-jodariou.github.io/Gaulois-V2/.
- Juste après une publication, une page gardée par le navigateur s'affiche sans style : GitHub Pages garde les pages 10 min et chaque publication supprime les anciens `_astro/`. Fenêtre neuve, puis Ctrl + F5 ; ce n'est pas une panne.

## Mettre en ligne un changement de schéma Supabase

1. Nouvelle migration seulement (jamais en modifier une appliquée), relue avec la skill `migration-supabase`.
2. `npx supabase config diff --remote=zxavwcupauheheqxfdez` pour voir l'écart avec le vrai projet.
3. Accord explicite, puis la personne lance `npx supabase db push`.
4. Sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY`, le jeu reste fermé : ne poser ces variables GitHub qu'une fois le schéma installé et le site publié à jour.
5. Après publication : `npm run verifier:ligne`.
