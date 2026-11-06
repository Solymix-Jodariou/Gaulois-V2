---
paths:
  - "tests/**"
  - "playwright.config.ts"
  - "vitest.config.ts"
  - ".claude/launch.json"
---

# Tests, démo et ports

- `npm run lint`, `npm run typecheck`, `npm test` (= `test:unit` + `test:db` : formules, règles, droits et attaques simultanées sur un vrai Postgres 18 via `embedded-postgres`, sans Docker), puis `npm run build` et `npm run test:e2e` (Playwright : parcours, axe WCAG AA, largeurs d'écran, parcours complet du jeu). Tests ciblés d'abord : `npx vitest run --project unit tests/unit/x.test.ts`, puis la suite.
- Sous charge, un test du jeu peut dépasser 30 s (`testTimeout`) : le relancer seul avant de conclure. Après `test:e2e`, la base locale disparaît : rien à nettoyer.
- Les tests ne couvrent ni un vrai téléphone, ni Firefox, ni Safari, ni un lecteur d'écran, ni la barre de défilement (15 px) ; un contraste sur dégradé se vérifie à l'œil.

## Ports

- Playwright réutilise ce qui écoute sur 4321 (parfois une vieille version : rebâtir ou l'arrêter) et veut 4322 (site de la pile) et 54399 (faux Supabase) libres : arrêter d'abord sa démo. `Get-NetTCPConnection -State Listen` peut dire un port libre alors qu'il répond : tenter une vraie connexion.
- 4321 et 4322 sont en dur dans `playwright.config.ts`. Pour en changer : copie adaptée de la config, et `GAL_TEST_SITE_PORT` / `GAL_TEST_SUPABASE_PORT` exportés dans le shell, car `tests/support/conquete-stack.ts` et les specs les lisent aussi (sinon 8 tests échouent à la connexion et 18 ne tournent pas).
- Une seconde pile dans le même dossier écrase `dist-conquete/`.
- D'autres sessions tournent dans `.claude/worktrees/` sur d'autres ports (4342…) : jamais d'arrêt par filtre sur un nom ; `preview_stop` pour ce qu'on a lancé, sinon vérifier le port puis le chemin du processus avant de l'arrêter.

## Démo et aperçu

- `.claude/launch.json` : `site-gal` (aperçu de `dist/` sur 4321, après `npm run build`), `conquete-demo` et `conquete-demo-direct` (pile du jeu sur 4322 : partie fictive, comptes de démo, un don fictif validé toutes les 20 s ; `--direct` imite un accès donné par OpenFront). Tout reste local et disparaît à l'arrêt.
- La pile n'écoute que sur `127.0.0.1` : `localhost` échoue dans le navigateur intégré. Elle imite Supabase (`tests/support/fake-supabase.ts`) : fonctions SQL et droits sont les vrais, seuls Discord et le stockage des fichiers sont simulés.
- Arrêter l'aperçu avant `npm ci` : sinon `node_modules` reste à moitié vidé sous Windows.
- Les vraies réponses d'OpenFront (dons, pages copiées) n'entrent jamais dans un test : dons fictifs de même forme.
