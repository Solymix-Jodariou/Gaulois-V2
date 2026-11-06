---
paths:
  - "src/lib/conquete/**"
  - "src/components/conquete/**"
  - "src/pages/conquete/**"
  - "src/pages/admin.astro"
  - "src/pages/compte.astro"
  - "src/pages/direction.astro"
  - "src/pages/dons.astro"
  - "src/styles/conquete.css"
  - "config/conquete.json"
  - "supabase/migrations/**"
  - "scripts/conquete-*.ts"
  - "scripts/generate-conquete-*.ts"
  - "public/conquete/**"
  - "tests/db/**"
  - "tests/unit/conquete-*.test.ts"
  - "tests/e2e/*conquete*"
  - "docs/CONQUETE.md"
  - "docs/REGLES_CONQUETE.md"
  - "docs/DIRECTION.md"
---

# La Conquête des Gaulois

Jeu de territoires par saisons, réservé aux membres validés. Architecture, mise en ligne, réglages, vérifié et non vérifié : `docs/CONQUETE.md`. Règles pour les joueurs : `docs/REGLES_CONQUETE.md`, publiées sur `/conquete/regles`. Rôles et `/direction` : `docs/DIRECTION.md`. État au 06/11/2026 : branché au vrai Supabase, fondateur désigné, aucune vraie partie jouée ; prix et durées sont des estimations, réglables dans `/admin` même en cours de saison.

## Code

- Le serveur décide de tout : le navigateur appelle des fonctions SQL (`attack`, `review_donation`…) qui vérifient l'appelant et les règles, puis répondent. `src/lib/conquete/rules.ts` ne sert qu'à prévoir le résultat à l'écran.
- Une formule reste identique dans `rules.ts` et en SQL : `tests/db/formules.test.ts` vérifie l'accord. Un réglage ajouté va dans `config/conquete.json`, `internal.config_problem` et `src/lib/conquete/config-labels.ts`.
- Formules adaptées d'OpenFront (commit `5b75bd3`, AGPL-3.0) et réécrites, jamais copiées : capacité, régénération, pertes d'attaque, bonus de garnison ×5 sur la densité. Détail et raisons dans `docs/CONQUETE.md`.
- Aucun hasard : l'écran annonce le résultat exact avant confirmation et ne promet rien d'impossible (terre protégée, dernier territoire). Le second clic ne part que sur un succès annoncé ; une attaque annoncée perdante ne part que par le bouton du panneau.
- Pas de tâche planifiée pour jouer : la réserve se calcule à la demande, la guerre commence à la première action après sa date. Pouls `get_game_pulse` toutes les 15 s, relecture seulement s'il change ; un onglet caché ne demande rien ; le mot « direct » n'apparaît nulle part.
- Guide de première partie et alertes : chiffres pris dans les réglages de la saison, jamais en dur ; aucune action fictive, aucun résultat simulé. Rien n'est présenté comme un zéro : sans saison, la page le dit ; serveur muet, « Jeu indisponible ».

## Dons

- 1 capsule = 100 troupes (`troopsPerCapsule`) à l'instant de la validation, plafonné par la capacité ; dons d'avant le lancement et totaux de départ ne comptent que pour la capacité. Tout passe par `internal.grant_donation_troops`, sous le verrou de la saison. Un don est permanent : chaque écran de don le rappelle, et rien n'oblige à donner.
- Le site ne peut pas lire les dons : `/clans/GAL/donations` répond 401 sans compte, son CORS n'autorise qu'openfront.io, et les conditions d'OpenFront (sections 5 et 6.5) interdisent robot, session de joueur, script et extension. `OPENFRONT_DONATIONS_KEY` n'attend qu'une clé donnée par OpenFront, jamais une session ; seule `fetchDonations` dans `src/lib/conquete/job.ts` serait à adapter.
- Seule exception, décidée le 06/11/2026 sans attendre OpenFront : un officier recopie la liste à la main depuis son propre navigateur et la colle dans `/admin`, onglet Dons (`src/lib/conquete/donation-import.ts`, `import_openfront_donations`). Rien ne l'automatise ; les vraies réponses n'entrent jamais dans le dépôt, tests compris ; seuls l'`id`, le montant, la date et une empreinte du donneur sont envoyés ; le Plutonium est ignoré. Si OpenFront s'y oppose, la copie s'arrête.
- La première lecture est irréversible (admin ou fondateur, liste complète, confirmation) et remplace les déclarations : elle revient à la direction, avec un vrai compte. Après elle, un don importé par erreur se corrige à la main dans la base.
- Jamais de nom de donneur : les dons ne sont visibles qu'aux membres du clan. Un donneur anonyme le reste dans le fil et sur Discord.

## Carte du jeu

- 528 hexagones d'aires égales depuis Natural Earth (domaine public), générés par `scripts/generate-conquete-map.ts` et `generate-conquete-terrain.ts` ; noms dans `scripts/conquete-map-names.ts`, à relire par le clan. Une fois une saison jouée, toute refonte crée une nouvelle `VERSION` pour ne pas toucher aux saisons passées.
- Esprit de la carte d'OpenFront, sans ses images, ses couleurs exactes, ses cartes (`map.bin`) ni son code : la demande de les reprendre a été refusée le 06/11/2026, ne pas rouvrir. Le relief réaliste de Natural Earth a été jugé « trop réaliste » le même jour : viser une carte de jeu en aplats avec nos couleurs (deux variantes montrées, choix à venir), sans reproposer ce relief.
- Pas de temps réel ni de pixels, sans bots ni navires. Un vrai front case par case (carte `v2`, nouvelles règles) a été mesuré et proposé le 06/11/2026 : rien n'est décidé, à trancher après une vraie saison.

## Connu, non vérifié

- `list_events_to_notify` n'a pas de limite de date : poser `DISCORD_WEBHOOK_URL` plus tard annoncerait d'un coup les anciens événements de la saison en cours (lu dans le code, pas essayé).
- Pas vérifié sur le vrai projet : second compte validé, saison, captures, vraie partie, vrais dons ; ni Firefox, Safari, vrai téléphone, lecteur d'écran.
