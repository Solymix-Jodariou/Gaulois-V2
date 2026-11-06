---
name: tests-e2e
description: Lancer, cibler ou déboguer les tests Playwright du site GAL (parcours, accessibilité axe, largeurs d'écran, carte, effets) — build préalable, port 4321, serveur réutilisé, projets desktop et mobile, tests lents ou instables, captures d'écran. À utiliser pour npm run test:e2e et pour tout test qui échoue ou traîne.
paths:
  - "tests/**"
  - "playwright.config.ts"
---

# Tests e2e (Playwright)

Trois fichiers dans `tests/e2e/` : `site.spec.ts` (parcours, données affichées, accessibilité, défilement horizontal, pied de page, clavier), `carte.spec.ts` (film de la carte), `fx.spec.ts` (effets). Deux projets dans `playwright.config.ts` : `desktop` (1280 × 800) et `mobile` (375 × 812, tactile). Les tests lisent `data/leaderboard.json` et `data/members.json` et comparent la page aux fichiers.

## Avant de lancer

1. `npm run build` : les tests tournent sur `dist/`. Un `dist/` d'avant le changement fait passer ou échouer les tests pour de mauvaises raisons.
2. Première fois sur une machine : `npx playwright install chromium`.
3. Playwright sert `dist/` sur `127.0.0.1:4321` et **réutilise** un serveur déjà là (`reuseExistingServer`). Si un vieux `npm run preview` ou `npm run dev` écoute sur 4321, il sert une vieille version : l'arrêter d'abord. Sous Windows, trouver le processus par le port, `netstat -ano | findstr :4321`, vérifier son chemin, puis arrêter ce PID seulement. Jamais par filtre sur le nom ou la ligne de commande : d'autres sessions tournent dans `.claude/worktrees/`.

## Lancer

```bash
npm run test:e2e                                                        # tout
npx playwright test tests/e2e/site.spec.ts --project=desktop            # un fichier, un projet
npx playwright test -g "parcours principal"                             # un test par son nom
npx playwright test tests/e2e/site.spec.ts --reporter=line --trace=on   # avec trace en cas d'échec
```

Les captures, vidéos et traces vont dans `test-results/`, ignoré par Git. `npx playwright show-trace test-results/<dossier>/trace.zip` ouvre une trace.

## Un test échoue

- Lire l'assertion : la plupart comparent un chiffre affiché à `data/`. Si `data/` a changé entre le build et le test (collecte lancée entre-temps), rebuild.
- Un test de la carte ou des effets peut dépasser son délai sous charge : le relancer seul avant de conclure.
- Un test d'accessibilité liste des règles axe et des sélecteurs : corriger le HTML, jamais exclure la règle.
- Un test de défilement horizontal nomme la page et la largeur : chercher l'élément qui déborde (image sans `max-width`, halo, tableau, mot long), pas ajouter `overflow: hidden` sur le body.
- Rapporter tel quel : ce qui passe, ce qui échoue, la cause probable. Ne jamais marquer `skip`, affaiblir une attente ou modifier un test pour qu'il accepte une valeur inventée.

## Ajouter un test

Même style que l'existant : `data-testid` sur l'élément, valeur attendue lue dans `data/` ou `content/`, `hydrated(page)` avant de toucher un composant Preact, menu mobile ouvert par « Menu » dans le projet `mobile`. Une nouvelle page s'ajoute à `PAGES` (skill `nouvelle-page`).
