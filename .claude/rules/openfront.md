---
paths:
  - "src/lib/*.ts"
  - "src/lib/clanmap/**"
  - "src/pages/data/**"
  - "src/scripts/conquest.ts"
  - "src/scripts/film*.ts"
  - "scripts/fetch-data.ts"
  - "scripts/generate-clanmap.ts"
  - "data/**"
  - "tests/unit/**"
  - "docs/API_AUDIT.md"
  - "README.md"
  - "NOTICE.md"
---

# OpenFront : API, données, licences, conditions

Audit complet, réponses réelles et mesures : `docs/API_AUDIT.md` (5 et 6 novembre 2026). Les calculs affichés sont tous documentés dans `README.md` (« Les données ») et testés dans `src/lib/`. Les visiteurs n'appellent jamais l'API (CORS limité à openfront.io) : la GitHub Action collecte toutes les heures dans `data/`, chaque réponse validée par Zod (`src/lib/schemas.ts`).

## Routes et lecture

- Classement : `/public/clans/leaderboard`, 90 jours glissants, cache 1 h, sans champ `rank` : le rang est la position dans la liste, le score `weightedWins`, rien n'est recalculé ; afficher le `end` de la réponse. `elo` est une note de guerre classée : jamais mêlée aux stats de clan. Si GAL sort de la liste : « hors classement », jamais 0.
- Stats et sessions : `/public/clan/GAL` par fenêtres de 24 h au plus (jours UTC, regroupés ensuite en heure de Paris), `/sessions` par 50, dédupliquées par `gameId`, parties d'équipe publiques seulement. Un 200 avec des zéros ne prouve rien ; jamais de date future ; un ratio sans partie ne s'affiche pas.
- Membres : `/public/clan/GAL/members`, non documentée, donc susceptible de changer : garder la dernière liste valide. Stats membres : `stats.team` uniquement, jamais `total` (qui inclut le classé) ; `stats` absent → « pas de données » ; un 0 est un vrai zéro « sous le tag », pas « inactif ».
- Trésor : `/clans/GAL` (hors `/public`, non documentée), une fois par jour ; « Pas de données » quand elle ne répond pas.
- Carte des clans : seulement `/public/clanmap/history` (route documentée, rejouée depuis le premier pixel, contrôle par `previousClanId`, film non remplacé au moindre écart) et le terrain public du jeu (`resources/maps/giantworldmap/map.bin`, CC BY-SA 4.0, commit fixé dans `src/lib/clanmap/terrain.ts`, source et licence à garder sur la page). `/clanmap/ownership` a répondu 403 aux machines de GitHub le 06/11/2026 : ne pas contourner ce refus, et ne pas relire `/clanmap/*` sans accord d'OpenFront (section 5 des conditions). Ni troupes des clans, ni coût exact d'un pixel ennemi, ni qui a peint quoi.
- Ménager l'API : appels espacés d'au moins 300 ms, recul croissant sur 429 ou 5xx, liste des membres au plus une fois par jour. Aucune limite documentée.
- Si l'API échoue ou qu'une réponse ne passe pas la validation : garder les derniers fichiers valides, noter l'erreur dans `data/meta.json`, l'afficher. Le navigateur signale les données périmées (4 h pour classement et sessions, 36 h pour membres et carte). Jamais un historique présenté comme du direct.

## Constantes reprises du jeu

Calculateur (`src/lib/calculator.ts`, `FORMULA_COMMIT`), croissance (`src/lib/growth.ts`), coûts de la carte (`src/lib/clanmap/economy.ts`) : lus dans le code du jeu au commit `5b75bd3`. Si le jeu change ses règles, les mettre à jour à la main et le dire. Repère indicatif, jamais vérifié en partie réelle.

## Données personnelles

- `publicId` d'un membre sans pseudo jamais écrit dans les fichiers publiés ; ceux des membres avec pseudo sont conservés (lien vers leur profil). Un joueur supprimé disparaît avec le roster. La base du jeu ne garde que des empreintes.
- Dons et top donateurs : réservés aux membres (401), aucune route publique. Aucun nom sans `content/carte-heros.json`. Le Plutonium n'est ni affiché ni calculé.

## Conditions d'utilisation et licences

- Section 5 : aucun accès automatisé que le service ne fournit pas (robot connecté avec un compte, routes refusées aux machines). Section 6.5 : aucun script ni extension lisant le client du jeu, sauf accord écrit. Le site ne fait ni l'un ni l'autre ; le message à OpenFront est prêt dans `docs/CONQUETE.md`. Son site répond 403 à WebFetch : ses conditions se lisent dans son dépôt public (`resources/public/terms-of-service.html`).
- Code du jeu : AGPL-3.0 ; `/resources` : CC BY-SA 4.0, attribution « OpenFront ». Ce site : AGPL-3.0-only (`LICENSE`, `NOTICE.md`), mention « © OpenFront and Contributors » visible au pied de page. Du code repris d'OpenFront ou d'un autre projet AGPL (TeamStats…) se signale et se date dans son fichier (section 5 de l'AGPL), respecte les conditions de `NOTICE.md` et s'y ajoute ; les formules sont réécrites. Jamais ses images, cartes, couleurs ni mise en page. Ces lectures de licences et de conditions ne sont pas un avis juridique.
- Ne pas copier TeamStats : ses classements maison (Clan ELO, influence) et son « direct » contredisent les règles du site.
