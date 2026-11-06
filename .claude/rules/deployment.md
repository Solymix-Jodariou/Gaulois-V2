---
paths:
  - ".github/**"
  - "data/meta.json"
  - "data/history/**"
  - "scripts/fetch-data.ts"
  - ".env.example"
  - ".gitattributes"
  - ".gitignore"
---

# Publication, workflow et synchronisation

Site en ligne : https://solymix-jodariou.github.io/Gaulois-V2/ (dépôt `Solymix-Jodariou/Gaulois-V2`), publié par `.github/workflows/site.yml`. Un push sur `main` publie le site (jobs `test-db`, `build`, `deploy`) et peut aussi partir sur Railway, déploiement préexistant dont le rôle n'est pas établi. Rien n'est poussé sans accord explicite, donné pour ce push-là.

## Le robot de données

- Le job `update-data` collecte toutes les heures (`cron 23 * * * *`, souvent retardé ou sauté par GitHub) et pousse `data: mise à jour automatique`. Depuis le 06/11/2026, la tâche « Collecte GAL » de cron-job.org lance le workflow à la minute 53, avec un jeton GitHub réservé à cette tâche (droit Actions seul) ; le planning de GitHub sert de secours. Si les données se figent : onglet Actions, puis cette tâche et la date de son jeton.
- L'historique brut de la carte (environ 30 Mo) vit dans le cache `clanmap-…` de l'Action, hors Git ; perdu, il se retélécharge (plus de 350 appels). Si OpenFront remet sa carte à zéro, supprimer ce cache dans Actions → Caches.
- La tâche de la Conquête (`conquete:job`) tourne si `vars.SUPABASE_URL` est posée, avec les secrets `SUPABASE_SECRET_KEY`, `BACKUP_PASSPHRASE`, `DISCORD_WEBHOOK_URL`, `OPENFRONT_DONATIONS_KEY` ; sa sauvegarde chiffrée reste 14 jours en artefact. Une panne n'empêche jamais le site de se publier.

## Avant un push

1. Intégrer `origin/main` : il bouge souvent (robot, autres sessions). `sync_with_base_branch` peut échouer (« Committer identity unknown ») : fusionner à la main.
2. Garder les données du robot et le bloc `clanmap` de `data/meta.json` ; vérifier `data/history/` : Git peut y garder une vieille version sans signaler de conflit. `film.bin` et les `.webp` sont binaires (`.gitattributes`).
3. Contrôler la liste des fichiers : aucun secret, pas de `git add -A` aveugle, `supabase/.temp/` et `.env` ignorés.
4. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, puis prévisualiser (`site-gal`).
5. Après la publication : vérifier le run dans Actions (`gh` n'est pas installé : l'API publique de GitHub se lit sans lui), puis la page en ligne dans une fenêtre neuve (cache de 10 min, voir `frontend.md`).

## Variables et secrets

- `.env.example` tenu à jour. Variables GitHub : `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, publiques par nature. Secrets : tout le reste, jamais dans le navigateur ni le dépôt ; le Client Secret Discord ne va que dans le tableau de bord Supabase.
- Sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY` au build, le jeu reste fermé et le site entièrement statique.
