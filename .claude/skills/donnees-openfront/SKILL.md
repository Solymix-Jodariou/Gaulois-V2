---
name: donnees-openfront
description: Collecte et affichage des données OpenFront (API publique, carte des clans, dons, CGU) et reprise d'un fichier ou de code d'OpenFront avec la bonne licence. À utiliser pour tout travail sur scripts/, src/lib/ ou data/, et avant de copier quoi que ce soit du dépôt OpenFrontIO.
paths:
  - "scripts/**"
  - "src/lib/**"
  - "src/pages/data/**"
  - "src/scripts/conquest.ts"
  - "src/scripts/film*.ts"
  - "data/**"
  - "tests/unit/**"
  - "docs/API_AUDIT.md"
  - "README.md"
  - "NOTICE.md"
---

# Données OpenFront

## Ce que le site lit

- API publique `https://api.openfront.io/public/…` : audit complet, réponses réelles et mesures dans `docs/API_AUDIT.md` (5 et 6 novembre 2026). Les calculs affichés sont tous documentés dans `README.md` (« Les données ») et testés dans `src/lib/`.
- Les visiteurs n'appellent jamais l'API (CORS limité à openfront.io) : une GitHub Action collecte toutes les heures dans `data/` (`npm run data:fetch`), chaque réponse validée par Zod (`src/lib/schemas.ts`), puis reconstruit le site.
- Ménager l'API : appels espacés d'au moins 300 ms, recul croissant sur 429 ou 5xx, liste des membres au plus une fois par jour. Aucune limite documentée.
- Si l'API échoue ou qu'une réponse ne passe pas la validation : garder les derniers fichiers valides, noter l'erreur dans `data/meta.json`, l'afficher. Le navigateur signale les données périmées (4 h pour classement et sessions, 36 h pour membres et carte).

## Routes et lecture

- Classement : `/public/clans/leaderboard`, 90 jours glissants, cache 1 h, sans champ `rank` : le rang est la position dans la liste, le score `weightedWins`, rien n'est recalculé ; afficher le `end` de la réponse. `elo` est une note de guerre classée : jamais mêlée aux stats de clan. Si GAL sort de la liste : « hors classement », jamais 0.
- Stats et sessions : `/public/clan/GAL` par fenêtres de 24 h au plus (jours UTC, regroupés ensuite en heure de Paris), `/sessions` par 50, dédupliquées par `gameId`, parties d'équipe publiques seulement. Un 200 avec des zéros ne prouve rien ; jamais de date future ; un ratio sans partie ne s'affiche pas.
- Membres : `/public/clan/GAL/members`, non documentée, donc susceptible de changer : garder la dernière liste valide. Stats membres : `stats.team` uniquement, jamais `total` (qui inclut le classé) ; `stats` absent → « pas de données » ; un 0 est un vrai zéro « sous le tag », pas « inactif ».
- Trésor : `/clans/GAL` (hors `/public`, non documentée), une fois par jour ; « Pas de données » quand elle ne répond pas.
- Carte des clans : seulement `/public/clanmap/history` (route documentée, rejouée depuis le premier pixel, contrôle par `previousClanId`, film non remplacé au moindre écart) et le terrain public du jeu (`resources/maps/giantworldmap/map.bin`, CC BY-SA 4.0, commit fixé dans `src/lib/clanmap/terrain.ts`, source et licence à garder sur la page). Ni troupes des clans, ni coût exact d'un pixel ennemi, ni qui a peint quoi.
- `/clanmap/ownership` a répondu 403 aux machines de GitHub le 06/11/2026 : ne pas contourner ce refus, et ne pas relire `/clanmap/*` sans accord d'OpenFront (section 5 de ses conditions).

## Constantes reprises du jeu

Calculateur (`src/lib/calculator.ts`, `FORMULA_COMMIT`), croissance (`src/lib/growth.ts`), coûts de la carte (`src/lib/clanmap/economy.ts`) : lus dans le code du jeu au commit `5b75bd3`. Si le jeu change ses règles, les mettre à jour à la main et le dire. Repère indicatif, jamais vérifié en partie réelle.

## Affichage (rappel des règles du CLAUDE.md)

Rien d'inventé ; date de mise à jour visible ; « pas de données » ≠ zéro ; pas d'historique présenté comme du temps réel ; pas de mélange clan / classé ; si l'API échoue, garder les dernières données valides et le signaler ; pas de classement recalculé.

## Données personnelles

- `publicId` d'un membre sans pseudo jamais écrit dans les fichiers publiés ; ceux des membres avec pseudo sont conservés (lien vers leur profil). Un joueur supprimé disparaît avec le roster. La base du jeu ne garde que des empreintes.
- Dons et top donateurs : réservés aux membres (401), aucune route publique.

## Dons

- Les CGU d'OpenFront (sections 5 et 6.5) interdisent les robots et les scripts : jamais de lecture automatique des dons, ni de session de joueur dans `OPENFRONT_DONATIONS_KEY`, qui n'attend qu'une clé donnée par OpenFront.
- Seule exception, décidée le 06/11/2026 sans attendre l'accord d'OpenFront : un officier recopie la liste à la main et la colle dans `/admin` (`src/lib/conquete/donation-import.ts`). Rien n'automatise cette copie, et ses vraies réponses n'entrent jamais dans ce dépôt, tests compris. Si OpenFront s'y oppose, elle s'arrête.
- Aucun nom de donneur sans `content/carte-heros.json`. Ni nom ni montant exact de ce qui n'est visible qu'aux membres. Seules les capsules comptent : jamais de renvoi vers le Plutonium, qui n'est ni affiché ni calculé.

## Conditions d'utilisation d'OpenFront

- Section 5 : aucun accès automatisé que le service ne fournit pas (robot connecté avec un compte, routes refusées aux machines). Section 6.5 : aucun script ni extension lisant le client du jeu, sauf accord écrit. Le site ne fait ni l'un ni l'autre ; le message à OpenFront est prêt dans `docs/CONQUETE.md`.
- Son site répond 403 à WebFetch : ses conditions se lisent dans son dépôt public (`resources/public/terms-of-service.html`). Ces lectures de licences et de conditions ne sont pas un avis juridique.
- Ne pas copier TeamStats : ses classements maison (Clan ELO, influence) et son « direct » contredisent les règles du site.

## Reprendre un fichier ou du code d'OpenFront

Dépôt : https://github.com/openfrontio/OpenFrontIO — licences dans `LICENSE`, `LICENSE-ASSETS`, `LICENSING.md`. Ce site est sous AGPL-3.0-only (`LICENSE`, `NOTICE.md`), avec la mention « © OpenFront and Contributors » visible au pied de page.

| Quoi | Licence | Conditions |
|---|---|---|
| Code (`src/`, `packages/`, `server/`, `map-generator/`…) | AGPL-3.0 + conditions supplémentaires | En tête du fichier : « Repris d'OpenFront (lien), modifié le JJ/MM/AAAA ». Section 7 : mention « © OpenFront and Contributors » visible, origine non travestie. |
| `resources/` : cartes (`map.bin`, `manifest.json`, `thumbnail.webp`), images, polices, données | CC BY-SA 4.0, attribution « OpenFront » | Attribution et lien vers la licence sur la page qui l'utilise ; ce qui en dérive reste en CC BY-SA. |
| `proprietary/`, assets du CDN, skins et sons servis par l'API | Tous droits réservés | Jamais. |

Dans tous les cas : ajouter une ligne au tableau « Ce que la licence ne couvre pas » de `NOTICE.md`, ne pas reprendre le logo, et ne pas copier une mise en page qui ferait passer le site pour officiel. Les formules sont réécrites, jamais copiées. Même règle pour tout autre projet sous AGPL, comme TeamStats.

## Format des cartes du jeu (`resources/maps/<nom>/`)

- `manifest.json` : dimensions par échelle (`map` pleine, `map4x` demi, `map16x` quart), nombre de tuiles de terre, nations avec coordonnées à l'échelle pleine et code drapeau.
- `map.bin`, `map4x.bin`, `map16x.bin` : 1 octet par tuile, index `y * width + x`.
  - bit 7 : terre (1) / eau (0) — bit 6 : littoral — bit 5 : océan (eau seulement) — bits 0-4 : magnitude (altitude 0-30 pour la terre, distance à la terre pour l'eau).
  - `0b10011111` (terre + magnitude 31) : infranchissable, à rendre couleur de fond.
- Couleurs du client par défaut (`src/client/render/gl/utils/ColorUtils.ts`) : fond `#3c3c3c`, océan `#4785b5` assombri de `min(magnitude, 10)` par canal, littoral marin `round(0.7 × océan + 76.5)`, sable (204, 203, 158), plaines (190, 220 − 2m, 138) pour m < 10, hauteurs (200, 183, 138) + 2(m − 10) pour m < 20, montagnes (230, 230, 230) + floor(m / 2). Réécrire la logique, ne pas copier le fichier.
