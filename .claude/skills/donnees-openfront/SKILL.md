---
name: donnees-openfront
description: Collecte et affichage des données OpenFront (API publique, carte des clans, membres, dons, conditions d'utilisation) et reprise d'un fichier ou de code du dépôt OpenFrontIO avec la bonne licence. À utiliser pour tout travail sur scripts/, src/lib/ ou data/, et avant de copier quoi que ce soit d'OpenFront.
paths:
  - "scripts/**"
  - "src/lib/**"
  - "data/**"
---

# Données OpenFront

## Ce que le site lit

Audit complet, routes et réponses observées : `docs/API_AUDIT.md`. Les visiteurs n'appellent jamais l'API : la GitHub Action collecte toutes les heures (`npm run data:fetch`, `src/lib/pipeline.ts`), écrit dans `data/`, puis le site se reconstruit. Un test e2e échoue si le navigateur appelle `api.openfront.io`.

| Route | Sert à | Statut |
|---|---|---|
| `GET /public/clans/leaderboard` | Classement officiel, rang, score `weightedWins` | Documentée |
| `GET /public/clan/GAL` et `/sessions` | Sessions du clan, archivées par mois dans `data/sessions/` | Documentée |
| `GET /public/clan/GAL/members` | Liste des membres, `stats.team` | Non documentée, peut changer |
| `GET /public/leaderboard/ranked` | Décompte par mode des membres avec pseudo au classé (`data/ranked.json`), sans nom ni chiffre individuel, à part des stats de clan | Documentée |
| `GET /clans/GAL` | Trésor du clan (capsules, troupes) | Hors `/public`, non documentée ; n'a pas répondu depuis GitHub le 6 novembre 2026 |
| `GET /public/clanmap/history` | Historique de la carte des clans, rejoué en film | Documentée pour cet usage |
| `/clanmap/ownership` et le reste de `/clanmap/*` | — | Refusée aux machines de GitHub (403) : ne pas contourner, ne pas relire sans accord d'OpenFront |

- `data/` n'est écrit que par la collecte. Jamais à la main, jamais une valeur « pour tester ».
- Toute réponse passe par un schéma Zod de `src/lib/schemas.ts`. Réponse invalide ou API en panne : les derniers fichiers valides restent, l'erreur va dans `data/meta.json`, le site l'affiche. Un champ nouveau = schéma + test unitaire + affichage daté.
- Les calculs (rang, score, taux, créneaux, jeu en groupe, ma place, territoire, coûts) sont listés dans `README.md` et vivent dans `src/lib/` avec un test chacun. Les constantes de jeu (`src/lib/calculator.ts`, `src/lib/clanmap/economy.ts`) sont figées à un commit d'OpenFront : si le jeu change, les mettre à jour à la main et noter le commit.
- Stats des membres : `stats.team` uniquement. Le `publicId` d'un anonyme n'est jamais publié ; le serveur de connexion n'en garde que l'empreinte.
- L'historique brut de la carte (`.cache/clanmap/`, environ 30 Mo) reste hors de Git, dans le cache de l'Action. Perdu, il se retélécharge (plus de 350 appels).

## Dons et conditions d'utilisation

- Les conditions d'OpenFront (sections 5 et 6.5) interdisent robots et scripts : aucune lecture automatique de ce qui demande un compte de joueur, aucune session de joueur dans une variable d'environnement.
- Les dons sont réservés aux membres dans le jeu. Seule voie : un officier recopie la liste à la main dans `/admin` (`src/components/compte/AdminApp.tsx`, migration `20261106000200_dons_copies_a_la_main.sql`) ou le clan remplit `content/carte-heros.json`. Rien n'automatise cette copie.
- Aucun nom de donneur ni montant sans cette liste. Capsules seulement : ne jamais pousser vers le Plutonium, monnaie payante.

## Reprendre un fichier ou du code d'OpenFront

Dépôt : <https://github.com/openfrontio/OpenFrontIO> — licences dans `LICENSE`, `LICENSE-ASSETS`, `LICENSING.md`.

| Quoi | Licence | Conditions |
|---|---|---|
| Code (`src/`, `packages/`, `server/`, `map-generator/`…) | AGPL-3.0 avec conditions supplémentaires | En tête du fichier : « Repris d'OpenFront (lien), modifié le JJ/MM/AAAA ». Mention « © OpenFront and Contributors » visible, origine non travestie |
| `resources/` : cartes (`map.bin`, `manifest.json`, `thumbnail.webp`), images, polices, données | CC BY-SA 4.0, attribution « OpenFront » | Attribution et lien vers la licence sur la page qui l'utilise ; ce qui en dérive reste en CC BY-SA |
| `proprietary/`, assets du CDN, skins et sons servis par l'API, logo | Tous droits réservés | Jamais |

Dans tous les cas : une ligne au tableau « Ce que la licence ne couvre pas » de `NOTICE.md`, pas de mise en page qui ferait passer le site pour officiel. Même règle pour tout autre projet sous AGPL, comme TeamStats. Réécrire la logique vaut mieux que copier le fichier.

## Format des cartes du jeu (`resources/maps/<nom>/`)

- `manifest.json` : dimensions par échelle (`map` pleine, `map4x` demi, `map16x` quart), tuiles de terre, nations avec coordonnées et drapeau.
- `map.bin`, `map4x.bin`, `map16x.bin` : 1 octet par tuile, index `y * width + x`. Bit 7 : terre (1) / eau (0). Bit 6 : littoral. Bit 5 : océan (eau seulement). Bits 0-4 : magnitude (altitude 0-30 pour la terre, distance à la terre pour l'eau). `0b10011111` : infranchissable, couleur de fond.
- Couleurs du client par défaut (`src/client/render/gl/utils/ColorUtils.ts`) : fond `#3c3c3c` ; océan `#4785b5` assombri de `min(magnitude, 10)` par canal ; littoral marin `round(0.7 × océan + 76.5)` ; sable (204, 203, 158) ; plaines (190, 220 − 2m, 138) pour m < 10 ; hauteurs (200, 183, 138) + 2(m − 10) pour m < 20 ; montagnes (230, 230, 230) + floor(m / 2). Déjà repris, signalé et daté dans `public/carte-monde/index.html`.
