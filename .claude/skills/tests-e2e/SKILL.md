---
name: tests-e2e
description: Lancer ou déboguer les tests Playwright (parcours, accessibilité, largeurs d'écran) et la pile de démo de la Conquête — ports 4321/4322/54399, processus à arrêter, variables GAL_TEST_*. À utiliser pour npm run test:e2e ou tout test lent ou instable.
paths:
  - "tests/**"
  - "playwright.config.ts"
  - "vitest.config.ts"
  - ".claude/launch.json"
---

# Tests e2e (Playwright)

## Les suites

- `npm test` = `test:unit` + `test:db` (formules, règles, droits et attaques simultanées sur un vrai Postgres 18 via `embedded-postgres`, sans Docker). Puis `npm run build` et `npm run test:e2e` (Playwright : parcours, axe WCAG AA, largeurs d'écran, parcours complet du jeu).
- Tests ciblés d'abord : `npx vitest run --project unit tests/unit/x.test.ts`, puis la suite complète.
- Les tests ne couvrent ni un vrai téléphone, ni Firefox, ni Safari, ni un lecteur d'écran, ni la barre de défilement (15 px) ; un contraste sur dégradé se vérifie à l'œil.
- Les vraies réponses d'OpenFront (dons, pages copiées) n'entrent jamais dans un test : dons fictifs de même forme.

## Avant de lancer

1. `npm run build` d'abord : les tests e2e tournent sur `dist/`. Première fois : `npx playwright install chromium`.
2. Playwright réutilise ce qui écoute sur 4321 — parfois une vieille version : rebâtir ou l'arrêter — et veut 4322 (site de la pile) et 54399 (faux Supabase) libres. Arrêter d'abord la démo de la Conquête (`conquete-demo` dans `.claude/launch.json`).
3. `Get-NetTCPConnection -State Listen` peut dire un port libre alors qu'il répond : tenter une vraie connexion avant de conclure.
4. Ne jamais arrêter un processus par filtre sur son nom ou sa ligne de commande : d'autres sessions tournent dans `.claude/worktrees/` sur d'autres ports (4342…). `preview_stop` pour ce qu'on a lancé ; sinon vérifier le port puis le chemin du processus, et arrêter ce processus-là seulement.

## Changer de ports

4321 et 4322 sont en dur dans `playwright.config.ts`. Pour en changer : adapter une copie de la config et exporter `GAL_TEST_SITE_PORT` et `GAL_TEST_SUPABASE_PORT` dans le shell, car la pile (`tests/support/conquete-stack.ts`) et les tests les lisent aussi (sinon 8 tests échouent à la connexion et 18 ne tournent pas).

Une seconde pile dans le même dossier écrase `dist-conquete/`.

## Démo et aperçu

- `.claude/launch.json` : `site-gal` (aperçu de `dist/` sur 4321, après `npm run build`), `conquete-demo` et `conquete-demo-direct` (pile du jeu sur 4322 : partie fictive, comptes de démo, un don fictif validé toutes les 20 s ; `--direct` imite un accès donné par OpenFront). Tout reste local et disparaît à l'arrêt.
- La pile n'écoute que sur `127.0.0.1` : `localhost` échoue dans le navigateur intégré. Elle imite Supabase (`tests/support/fake-supabase.ts`) : fonctions SQL et droits sont les vrais, seuls Discord et le stockage des fichiers sont simulés.
- Arrêter l'aperçu avant `npm ci` : sinon `node_modules` reste à moitié vidé sous Windows.

## Un test échoue

- Sous charge, un test du jeu peut dépasser 30 s (`testTimeout`) : le relancer seul avant de conclure.
- `npm run test:unit` et `npm run test:db` isolent les deux moitiés de `npm test`. Après `test:e2e`, la base locale disparaît : rien à nettoyer.
- Rapporter le résultat tel quel, sans embellir : ce qui passe, ce qui échoue, et la cause probable.
