---
name: verifier
description: Lance tous les contrôles du site GAL dans l'ordre (lint, typecheck, tests unitaires, build, tests e2e Playwright, coup d'œil visuel) et rapporte le résultat tel quel. À utiliser avant tout commit, avant /publier, et dès qu'un changement touche src/, scripts/, config/, content/ ou supabase/.
---

# Vérifier le site

Tout doit passer avant qu'un changement parte. Si un contrôle échoue : corriger, relancer ce contrôle seul, puis relancer toute la série depuis le début. Ne jamais faire passer un contrôle en l'affaiblissant : pas de `skip`, pas de seuil abaissé, pas de test modifié pour accepter une valeur qui n'existe pas.

## La série, dans cet ordre

1. `npm run lint`
2. `npm run typecheck` — `astro check` puis `tsc --noEmit`.
3. `npm test` — Vitest. Les calculs de `src/lib/` ont chacun leur test dans `tests/unit/` : un calcul ajouté ou modifié sans test n'est pas fini.
4. `npm run build` — régénère `public/generated/` et `dist/`. Le build signale dans ses journaux un fichier JSON de `content/` invalide : le lire, pas seulement le code de sortie.
5. `npm run test:e2e` — Playwright sur `dist/` (détails et pannes : skill `tests-e2e`). Les tests lisent `data/leaderboard.json` et `data/members.json` : s'ils manquent, `npm run data:fetch` d'abord.
6. Coup d'œil visuel sur ce qui a changé : avec `dist/` servi sur <http://127.0.0.1:4321> (`npm run preview -- --host 127.0.0.1 --port 4321`, ou le serveur que Playwright a laissé), capturer la page en mobile et en desktop, puis regarder les images :

   ```bash
   npx playwright screenshot --viewport-size=375,812 --full-page http://127.0.0.1:4321/la-page test-results/la-page-mobile.png
   npx playwright screenshot --viewport-size=1280,800 --full-page http://127.0.0.1:4321/la-page test-results/la-page-desktop.png
   ```

   Chercher : texte coupé, bloc vide, contraste faible, chevauchement, valeur « 0 » là où il faudrait « Pas de données », mention de licence disparue. `test-results/` est ignoré par Git.

## Ce que les tests ne voient pas

- Un contraste sur un dégradé : juger sur la capture.
- Une vraie barre de défilement retire 15 px de largeur : une page qui tient juste à 1 024 px peut déborder chez un visiteur.
- Les lecteurs d'écran : vérifier à la main qu'un chiffre animé a sa valeur finale dans le HTML et que les images décoratives ont `alt=""`.

## Rapport

Une ligne par contrôle : passe ou échoue, et pour un échec la cause probable en une phrase. Ne pas écrire « tout est bon » si un contrôle n'a pas tourné : dire lequel et pourquoi.
