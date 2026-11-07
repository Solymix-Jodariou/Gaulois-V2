# Audit de l'API OpenFront pour le clan [GAL]

- **Date des tests :** 5 novembre 2026, vers 10 h UTC.
- **Base testée :** `https://api.openfront.io`.
- **Documentation lue :** [`docs/API.md`](https://github.com/openfrontio/OpenFrontIO/blob/main/docs/API.md).
- **Code du jeu lu :** branche `main`, commit `5b75bd3` (`packages/shared/src/ClanApiSchemas.ts`, `src/client/ClanApi.ts`, `packages/engine/src/configuration/EngineConfig.ts`, `packages/engine/src/execution/AttackExecution.ts`).

Toutes les réponses citées sont réelles. Elles sont raccourcies avec `…`, et les identifiants de joueurs sont masqués, car ce document sera public.

## 1. Ce qu'il faut retenir

| Sujet | Résultat |
|---|---|
| Classement officiel | Disponible et mis en cache 1 h. Il couvre 90 jours glissants. GAL est **2ᵉ** au moment du test. |
| Stats du clan | Disponibles, par fenêtre de **24 h maximum**. `start` et `end` sont obligatoires. |
| Sessions du clan | Disponibles, par 50 maximum, jusqu'au 12 novembre 2025. |
| **Liste officielle des membres** | **Elle existe** : `/public/clan/GAL/members`, **non documentée**. 759 membres, dont 475 sans pseudo. |
| Fiche du clan (nom, description, ouverture) | `/clans/GAL` répond sans authentification, mais hors `/public` et hors documentation. |
| Historique du rang | **Impossible à reconstruire** : l'API ne donne que le classement actuel. |
| Appels depuis le navigateur | **Bloqués par le CORS**, ce qui confirme le choix de la GitHub Action. |
| Limites de requêtes | Aucune documentée, et aucune atteinte pendant les tests. Le seuil réel reste inconnu. |
| Carte officielle des clans | Rejouable depuis le premier pixel par la route documentée `/public/clanmap/history`, en ligne depuis le 6 novembre 2026 au plus tard. Voir la section 8. |

### Points à trancher

1. **Plusieurs liens Discord, un seul serveur.** Le lien retenu est `discord.gg/cjUc42T7Y2`, fourni pendant le projet. La fiche du clan dans le jeu donne `discord.gg/VdCHEUMWzb` et le brief initial `discord.gg/GHDVgtuHxw`. Vérifiés auprès de Discord, les trois sont valides, sans expiration, et mènent au même serveur « [GAL] OpenFront 🇫🇷 ».
2. **Le nom dans le jeu** est « Les Gaulois Rejoignez Discord », pas « Les Gaulois ».
3. **Le clan n'est pas ouvert** (`isOpen: false`) : il faut demander une invitation, et la page Rejoindre doit le dire.
4. **La description dans le jeu indique une condition d'entrée** : un vocal obligatoire sur Discord pour jouer en équipe avec le tag.
5. **Le tag est plus ancien que le clan.** Des parties existent dès le 12 novembre 2025, alors que le clan a été créé le 10 avril 2026 et que le premier `joinedAt` date du 3 mai 2026.

## 2. Endpoints testés

### `GET /public/clans/leaderboard` — statut 200

Aucun paramètre n'est pris en compte : `start`, `end`, `limit` et `page` sont ignorés.

```json
{
  "start": "2026-08-07T09:26:45.415Z",
  "end": "2026-11-05T09:26:45.415Z",
  "clans": [
    {"clanTag":"UN","games":148579,"wins":48866,"losses":99713,"playerSessions":361053,"weightedWins":10617.53,"weightedLosses":6203.93,"weightedWLRatio":1.71,"elo":1463},
    {"clanTag":"GAL","games":5898,"wins":2464,"losses":3434,"playerSessions":15420,"weightedWins":2079.31,"weightedLosses":310.85,"weightedWLRatio":6.69,"elo":1470},
    {"clanTag":"ITA","games":29018,"wins":8265,"losses":20753,"playerSessions":41370,"weightedWins":2009.74,"weightedLosses":890.94,"weightedWLRatio":2.26,"elo":1477}
  ]
}
```

Constats :

- **Il n'y a pas de champ `rank`.** Le rang est la position dans le tableau. Le tri par `weightedWins` décroissant a été vérifié sur toute la liste, donc on ne recalcule rien.
- **Le « score » est `weightedWins`**, avec une demi-vie de 30 jours.
- **La fenêtre est de 90 jours glissants.** Les totaux ne sont donc pas des totaux depuis la création du clan.
- **`end` date la donnée.** Pendant le test, `end` valait 09:26 pour un appel à 10:01. Le site doit afficher ce `end` en plus de l'heure de récupération.
- **`Cache-Control: public, max-age=3600` :** interroger plus d'une fois par heure ne sert à rien.
- **Le tableau contient 102 clans**, alors que la documentation annonce un top 100. Le site ne doit pas supposer une longueur fixe.
- **`elo` est une note de guerre de clans classée** (`null` pour 94 clans sur 102). Elle reste séparée des stats de clan, conformément à la règle 6.
- **Si GAL sort de la liste**, il faudra afficher « hors classement », jamais `0`.

### `GET /public/clan/GAL` — statut 400 sans paramètres, 200 avec

`start` et `end` sont obligatoires, et les parties classées et Humains contre Nations sont exclues.

```json
{
  "start": "2026-11-04T00:00:00.000Z",
  "end": "2026-11-04T23:59:59.000Z",
  "clan": {
    "clanTag": "GAL", "games": 78, "playerSessions": 293, "wins": 42, "losses": 36,
    "weightedWins": 70.11, "weightedLosses": 9.5, "weightedWLRatio": 7.38,
    "teamTypeWL": {"2": {"wl": [8,3], "weightedWL": [4.71,0.11]}, "Trios": {"wl": [3,8], "weightedWL": [15.71,1.64]}, "…": {}},
    "teamCountWL": {"2": {"wl": [9,3], "weightedWL": [5.21,0.11]}, "39": {"wl": [1,1], "weightedWL": [6.27,0.16]}, "…": {}},
    "softBalance": "37685", "hardBalance": "1178"
  }
}
```

| Test | Résultat |
|---|---|
| Fenêtre d'exactement 24 h | 200 |
| Fenêtre de 24 h + 1 s | 400, `Time range cannot exceed 1 day` |
| Tag en minuscules (`gal`) | 200, résultat identique |
| Tag inexistant (`ZZZZZ`) | **200 avec des zéros et `weightedWLRatio: 1`** |
| Date future | **200 avec des zéros** |

Conséquences pour la règle « pas de données ≠ zéro » :

- Un `200` avec `games: 0` ne prouve pas que le clan existe. `/public/clan/GAL/exists` répond `{"exists":true}` et permet de le vérifier.
- Un ratio de `1` sur 0 partie n'a pas de sens : il ne doit jamais être affiché.
- On n'interroge jamais de date future, et on affiche « pas de données » pour les jours antérieurs à la première partie.

### `GET /public/clan/GAL/sessions` — statut 200

```json
{
  "results": [
    {"gameId":"dX3XnVEzub","clanTag":"GAL","clanPlayerCount":3,"hasWon":false,"numTeams":16,"playerTeams":"Trios","totalPlayerCount":47,"gameStart":"2026-11-04T23:57:16.183Z","score":-0.26}
  ],
  "total": 78, "page": 1, "limit": 50
}
```

- **`limit` maximum : 50.** À 51, la réponse est un 400.
- **Une page au-delà de la fin** renvoie `results: []` avec le bon `total`.
- **L'ordre est du plus récent au plus ancien.** Une nouvelle partie peut décaler les pages pendant la lecture, donc il faut dédupliquer par `gameId` et vérifier `total`.
- **`gameId` est unique** : 78 lignes et 78 identifiants distincts sur la journée testée.
- **Seule l'heure de début est fournie**, pas la fin ni la carte.
- **Il n'y a que des parties d'équipe publiques.** La heatmap ne couvre donc ni le FFA, ni le classé, ni Humains contre Nations, et le site doit l'indiquer.

### `GET /public/clan/GAL/members` — statut 200, non documenté

Accessible sans authentification. Le chemin `/clans/GAL/members` répond 401.

```json
{
  "results": [
    {
      "role": "officer",
      "joinedAt": "2026-05-03T20:17:40.935Z",
      "publicId": "<masqué>",
      "username": "<masqué>",
      "stats": {
        "total": {"wins":80,"losses":88}, "team": {"wins":69,"losses":43}, "ffa": {"wins":2,"losses":45},
        "hvn": {"wins":0,"losses":0}, "ranked": {"wins":9,"losses":0}, "1v1": {"wins":6,"losses":0},
        "duos": {"wins":1,"losses":3}, "trios": {"wins":5,"losses":9}, "quads": {"wins":10,"losses":8},
        "2": {"wins":6,"losses":3}, "…": {}
      },
      "eloContributed": null, "level": 24, "prestige": 1, "legend": false
    }
  ],
  "total": 759, "page": 1, "limit": 10
}
```

Mesures sur l'ensemble du roster (16 pages de 50 membres) :

| Mesure | Valeur |
|---|---|
| Membres récupérés / distincts | 759 / 759 |
| Rôles | 1 chef, 8 officiers, 750 membres |
| `username: null` | 475 (affichés « Membre anonyme ») |
| Avec un pseudo | 284 |
| 0 victoire et 0 défaite | 281 (191 anonymes, 90 avec pseudo) |
| `level` absent | 233 |
| `eloContributed` renseigné | 4 |
| Premier / dernier `joinedAt` | 3 mai 2026 / 4 novembre 2026 |

**Ce que mesurent ces stats.** J'ai comparé trois membres à leurs sessions individuelles (`/public/player/:id/sessions`) :

| Membre | Stats `/members` | Sessions de ce joueur portant le tag GAL | Toutes ses parties publiques depuis son arrivée |
|---|---|---|---|
| A | équipe 69-43, FFA 2-45, classé 9-0 | équipe 69-43, FFA 2-45, classé 6-0 + 3-0 | FFA 3-56 |
| B | équipe 11-2, H. c. Nations 1-1 | 12-3 en mode équipe | 12-3 |
| C | tout à 0 | **aucune** | équipe 22-121, FFA 3-135 |

- **Les stats comptent les parties jouées avec le tag GAL.** Sur les trois membres testés, elles ne comptent pas les parties jouées sans le tag. C'est un recoupement sur 3 joueurs, pas une garantie officielle.
- **Un `0` est donc un vrai zéro « avec le tag »**, pas une donnée masquée, et il concerne aussi bien des membres anonymes que des membres avec pseudo. Le membre C a joué, mais pas sous le tag : il faut écrire « aucune partie sous le tag », pas « inactif ».
- **`total` inclut le classé** : `total = ffa + team + hvn + ranked` est vrai pour les 759 membres. Le site ne doit **pas** l'utiliser comme stat de clan (règle 6). Le champ adapté est `team`, le seul de même nature que le classement des clans.
- **`stats` reste optionnel dans le schéma du jeu.** S'il manque, il faudra afficher « pas de données », pas 0.

### `GET /clans/GAL` — statut 200, hors `/public` et non documenté

```json
{
  "name": "Les Gaulois Rejoignez Discord",
  "tag": "GAL",
  "description": "Les gaulois 🇫🇷⚔️  | Clan francophone actif, vocal obligatoire pour jouer avec notre TAG en équipe, sur Discord ! Rejoignez nous : https://discord.gg/VdCHEUMWzb",
  "isOpen": false,
  "createdAt": "2026-04-10T23:34:46.720Z",
  "memberCount": 759,
  "discordUrl": "https://discord.gg/VdCHEUMWzb",
  "softBalance": "37685", "hardBalance": "1178",
  "troops": 6411424,
  "boostEndsAt": null
}
```

C'est une route de l'application du jeu, pas de l'API publique : elle peut changer sans préavis.

### `GET /public/player/:id` et `/sessions` — statut 200

- `/public/player/:id` renvoie les stats complètes, tous modes confondus, y compris pour un membre sans pseudo (`username: null`).
- `/public/player/:id/sessions` renvoie 100 lignes par page avec un curseur, et indique le `clanTag` utilisé dans chaque partie.
- **Non utilisés en V1 :** le roster suffit, les profils détaillés sont hors périmètre, et ces routes demanderaient au moins 759 appels. Elles restent disponibles pour une future page de profil.

### `GET /public/leaderboard/ranked` — statut 200, documenté

Testé le 7 novembre 2026. Paramètre `page`, 1 ou 2. Chaque page donne 50 joueurs par mode, donc les places 1 à 100 de `1v1`, `2v2` et `ffa`. `Cache-Control: public, max-age=900`.

```json
{
  "1v1": [{"rank":1,"elo":"…","peakElo":"…","wins":"…","losses":"…","total":"…","public_id":"<masqué>","accountUsername":null,"username":"<masqué>","level":"…","prestige":"…","legend":false}],
  "2v2": ["…"],
  "ffa": ["…"]
}
```

- **Ce classement est individuel.** Il ne dit pas sous quel tag les parties ont été jouées, et ne se mélange pas aux stats de clan.
- **La collecte n'écrit que des décomptes par mode** : places lues, membres avec pseudo sur ces places, et combien dans les 10 premières. Les membres sont reconnus par `public_id` dans la liste stockée, qui n'a pas l'identifiant des anonymes : ces nombres sont donc des minimums.
- **Pourquoi aucun nom ni Elo.** Le site limite les stats publiées d'un membre à `stats.team`. Une place, un Elo ou un bilan au classé n'en font pas partie, et peuvent venir de parties jouées hors du tag.
- **Un mode vide est traité comme une panne**, comme une liste de membres incomplète : le dernier relevé valide reste.
- **Les deux pages sont lues l'une après l'autre.** Un joueur qui change de place entre-temps peut figurer sur les deux : il n'est compté qu'une fois, à sa meilleure place.

### `GET /public/game/:id`, `/public/player/:id/games`, `/public/games` — statut 200, documentés, pas encore utilisés

Testés le 7 novembre 2026, à la main.

- **`/public/game/:id?turns=false`** donne la carte, la durée, le tag et le `publicID` de chaque joueur, les vainqueurs (`info.winner`) et des stats détaillées par joueur. Sur 20 parties récentes : environ 47 Ko et 170 ms par réponse, `hasWon` d'accord avec les vainqueurs 20 fois sur 20, `clanPlayerCount` égal au nombre de joueurs GAL 19 fois sur 20. Dans une partie, GAL avait des joueurs des deux côtés. Y lire des joueurs imposerait de ne garder aucun `publicID` d'anonyme et de suivre `/public/players/recently-deleted`.
- **`/public/player/:id/games`** donne pour un joueur la carte, la durée et le résultat de chaque partie, 10 lignes par page dans l'essai.
- **`/public/games`** donne les métadonnées de toutes les parties, sur 2 jours au plus par appel.

### Parties seules dans le salon

Sur 13 272 sessions du 10 avril au 6 novembre 2026, 11 ont un `totalPlayerCount` de 1, et toutes sont gagnées. Le détail de l'une d'elles confirme un seul joueur humain, dans une partie publique avec 400 robots. Ces parties ont les meilleurs scores de toute l'archive : le site ne publie donc pas de record de score, et les écarte de ses autres records.

### Routes essayées qui n'existent pas (404)

`/public/clan/GAL/players`, `/public/clans`, `/public/clan/GAL/info`, `/stats`, `/profile`, `/elo`, `/history`, `/requests`, `/bans`, `/wars`, `/public/clans/GAL`.

`/clans/GAL/games` existe mais répond 401.

## 3. Fenêtres, CORS, limites et cohérence

### Fenêtres `start` / `end`

- **Limite stricte de 24 h**, confirmée ci-dessus.
- **Piège du changement d'heure :** une journée de Paris dure 25 h fin octobre, ce qui dépasse la limite. Il faut donc récupérer les sessions par jours UTC, puis les regrouper localement par jour de Paris.

### CORS

Avec `Origin: https://les-gaulois.github.io`, la réponse reste `Access-Control-Allow-Origin: https://openfront.io`. Un navigateur bloquera donc tout appel depuis notre domaine.

### Limites de requêtes

- Aucune documentation ni aucun en-tête `RateLimit-*` / `Retry-After`.
- **60 requêtes d'affilée sans pause** (14 s) : aucun 429.
- **400 requêtes espacées de 200 ms** (141 s) : aucune erreur.
- Ce n'est pas la preuve qu'il n'y a pas de limite. L'Action espacera ses appels d'au moins 300 ms, et s'arrêtera avec un délai croissant sur 429 ou 5xx.

### Cohérence des données

| Vérification | Résultat |
|---|---|
| Sessions du 4 nov. comparées à `/clan/GAL` | 78 parties, 42 victoires, 293 sessions joueurs : **identique** |
| Somme des `score` positifs / négatifs comparée à `weightedWins` / `weightedLosses` | 70,10 / 9,49 contre 70,11 / 9,5 : écart d'arrondi |
| Formule documentée appliquée à une session | -0,2637 contre `score: -0.26` : **conforme** |
| Somme quotidienne du 8 août au 4 nov. comparée au classement | 5 856 contre 5 898 parties ; l'écart de 42 s'explique plausiblement par les bords de fenêtre (7 août : 42 parties sur la journée entière ; 5 nov. : 2 parties) |

### Profondeur de l'historique

J'ai interrogé `/public/clan/GAL` jour par jour, du 4 novembre 2026 au 1ᵉʳ octobre 2025 (400 appels) :

- **Première partie :** 12 novembre 2025.
- **Total :** 17 551 parties et 5 553 victoires, avec 24 jours à zéro depuis la première partie.
- **Par mois :**

| Mois | Parties | Victoires | | Mois | Parties | Victoires |
|---|---:|---:|---|---|---:|---:|
| 2025-11 | 33 | 8 | | 2026-05 | 1 668 | 367 |
| 2025-12 | 100 | 14 | | 2026-06 | 2 083 | 646 |
| 2026-01 | 659 | 110 | | 2026-07 | 1 997 | 734 |
| 2026-02 | 1 468 | 318 | | 2026-08 | 1 473 | 557 |
| 2026-03 | 1 720 | 399 | | 2026-09 | 1 764 | 765 |
| 2026-04 | 1 565 | 361 | | 2026-10 | 2 745 | 1 131 |
| | | | | 2026-11 (au 4) | 276 | 143 |

Ces parties antérieures à la création du clan sont liées au **tag**, pas forcément au clan actuel. L'API publique ne permet pas de savoir qui les a jouées.

## 4. Faisable ou non

| Fonction prévue | Verdict | Source et limite |
|---|---|---|
| Rang, score, parties, victoires, taux | ✅ | Classement. Taux = `wins / games` sur 90 jours, à présenter comme tel. |
| Classement, écarts avec les voisins, recherche | ✅ | Classement. Écart = différence de `weightedWins`. Limité à la centaine de clans renvoyée. |
| Courbes de parties et de victoires | ✅ | Reconstruites jour par jour depuis les sessions, dès le premier déploiement. |
| Courbes de rang et de score | ⚠️ | **Pas de passé disponible** : la courbe commence au premier instantané. |
| Liste des membres, anonymes compris | ✅⚠️ | Route non documentée, donc susceptible de changer. Garder le dernier fichier valide en cas de panne. |
| Tri par victoires, parties, taux, arrivée | ✅ | Parties = `team.wins + team.losses`. Taux affiché « — » s'il n'y a aucune partie. |
| Heatmap jour × heure, heure de Paris | ✅ | Sessions. Uniquement les parties publiques en équipe avec le tag. |
| Joueurs connectés en direct | ❌ | Aucune source. Non proposé. |
| Liste ou profil des anciens membres | ❌ | Le roster ne donne que les membres actuels. |
| Nombre de joueurs du clan dans le temps | ⚠️ | Seulement via nos instantanés. Reconstruire par `joinedAt` oublierait ceux qui sont partis. |
| Description, ouverture, nom officiel | ⚠️ | Route hors `/public`. À valider (voir la proposition). |

## 5. Calculateur de troupes contre un bot

Formule lue dans `EngineConfig.attackLogic` (commit `5b75bd3`). Pour un humain attaquant un bot, **sur chaque case conquise** :

```text
pertes attaquant = M × 0,7 × borne(troupes_bot / troupes_attaque ; 0,6 ; 2)
                   × (0,463 × bonusAttaquant × bonusDéfenseur + 0,0039 × troupes_bot / cases_bot)
pertes bot       = troupes_bot / cases_bot
M = 80 en plaine, 100 en colline, 120 en montagne
```

`bonusAttaquant` et `bonusDéfenseur` valent presque 1 pour des territoires modestes, et ne baissent nettement qu'autour de 300 000 cases.

**Un point corrige le brief : la frontière ne change pas les pertes.** Dans le code, `borderSize` n'intervient que sur la **vitesse** de conquête. Les pertes dépendent du terrain, des troupes du bot et surtout de son **nombre de cases**. Le calculateur affichera donc une durée estimée selon la frontière, et les troupes nécessaires selon le reste.

Prototype exécuté, avec un attaquant de 20 000 cases :

| Bot (troupes / cases) | Plaine | Colline | Montagne | Durée sur frontière 20 → 200 (plaine, avec 1,5 × le minimum) |
|---|---:|---:|---:|---|
| 10 000 / 1 000 | 16 857 | 21 070 | 25 284 | 7,9 s → 0,8 s |
| 10 000 / 4 000 | 63 489 | 79 361 | 95 233 | 31,6 s → 3,2 s |
| 30 000 / 4 000 | 66 110 | 82 637 | 99 164 | 31,6 s → 3,2 s |
| 100 000 / 20 000 | 323 885 | 404 856 | 485 827 | 158,1 s → 15,8 s |

Limites à afficher avec la mention « repère indicatif » :

- Le calcul suppose un terrain uniforme et ignore la régénération du bot pendant l'attaque.
- **Il n'a pas été vérifié en partie réelle.** Ces chiffres viennent du code, pas d'une mesure.
- Il faudra que le joueur connaisse la taille du bot en cases. Je n'ai pas vérifié que le jeu l'affiche sous cette forme : **à confirmer par un joueur du clan.**
- Les constantes peuvent changer à chaque mise à jour du jeu. Le site indiquera le commit de référence.
- Le jeu est sous licence AGPL-3.0. Le calculateur réécrit le calcul sans copier de fichier et cite sa source. Le site est lui-même sous AGPL-3.0-only : voir `NOTICE.md`.

## 6. Parcours pour rejoindre le clan

Constaté dans `ClanDetailView.ts`, `ClanApi.ts` et `resources/lang/fr.json` :

- Il faut un compte : « Créez un compte pour rejoindre un clan ».
- Le clan étant fermé, le bouton affiché est « Demander une invitation », puis « Demande en attente d'une réponse ».
- Un chef ou un officier approuve ou refuse la demande.

Le parcours détaillé dans l'interface (où trouver le menu Clans) n'a pas été testé, car il demande un compte. Le texte final devra être relu par un membre du clan.

## 7. Données personnelles

- La documentation demande de retirer les joueurs supprimés (`/public/players/recently-deleted`). Le roster étant réécrit à chaque collecte et les instantanés ne contenant aucune donnée individuelle, un joueur supprimé disparaît dès qu'il quitte le roster.
- Les 475 membres sans pseudo n'en ont jamais défini (`null` signifie « jamais défini » dans le schéma du jeu). Par prudence, le site n'écrira pas leur `publicId` dans ses fichiers JSON, même si l'API l'expose.
- **Le lien entre `publicId` et pseudo** sera conservé pour les membres avec pseudo, ce qui permet un lien vers leur profil officiel.

## 8. Carte officielle des clans

Tests du 5 novembre 2026, entre 14 h 30 et 15 h 10 UTC, sauf mention contraire. La carte est visible sur `clanmap.openfront.io` sans compte. Les clans y peignent un territoire de 4 108 × 1 948 pixels. Ce n'est pas le classement des clans.

### Route lue par la collecte

Depuis le 6 novembre 2026, la collecte lit `GET /public/clanmap/history`, documentée dans `docs/API.md` « pour construire des timelapses ». Elle répondait 404 le 5 novembre à 14 h 38 UTC, et 200 le 6 novembre à 12 h 13 UTC.

- Chaque événement vaut `[seq, x, y, clanId, previousClanId, createdAt]`.
- La collecte suit `next` et garde la taille de page par défaut : la documentation indique que seules ces pages tombent dans le cache d'OpenFront. Après une interruption, elle reprend donc à la dernière page complète.
- `previousClanId` sert de contrôle à chaque mise à jour : si le rejeu ne retombe pas sur l'ancien propriétaire annoncé, le film n'est pas remplacé.
- `createdAt` n'est pas encore conservé : le film suit l'ordre des événements, sans dates. Il pourrait devenir une vraie frise temporelle.
- La route passe depuis GitHub : premier passage le 6 novembre 2026 à 13 h 01 UTC, en un peu plus de 3 minutes, avec 1 788 073 événements et 0 écart.

La route ne donne pas les troupes des clans : le site n'affiche donc plus le coût exact d'un pixel ennemi. Elle ne donne pas le terrain non plus, mais il est public : voir « Licences ».

### Routes de la page de la carte, plus lues par la collecte

Elles répondent sans authentification, hors `/public` et sans documentation. Elles ont été trouvées dans le code de la page et peuvent changer sans préavis.

**Le 6 novembre 2026 à 11 h 53 UTC, `/clanmap/ownership` a répondu 403 à la collecte sur GitHub.** Vingt minutes plus tard, la même route répondait 200 depuis une connexion personnelle, avec le même nom de client, et les routes `/public` passaient sur GitHub dans la même exécution. Le refus semble donc viser les machines de GitHub sur cette route. C'est une déduction : OpenFront n'a rien expliqué.

La collecte ne cherche pas à contourner ce refus. La section 5 des [conditions d'utilisation](https://openfront.io/terms-of-service.html) interdit d'accéder au service par un moyen ou une interface automatisés qu'il ne fournit pas. C'est une lecture de ces conditions, pas un avis juridique. Le message de la section 10 demande à OpenFront une version publique de ces données.

| Route | Réponse | Cache annoncé |
|---|---|---|
| `GET /clanmap/ownership` | `seq`, `width`, `height`, `clans[]`, `rle` : l'état complet, en paires (clan, longueur) sur 16 bits, encodées en base 64 | 5 min |
| `GET /clanmap/changes?since=N` | `seq`, `changes[]` : 5 000 événements `[seq, x, y, clanId]` au plus, et `clans` | Non relevé |
| `GET /clanmap/terrain` | Une case par pixel, en gzip : bit 7 = terre, bits 0 à 4 = relief | 1 h |
| `GET /clanmap/ships` | Les navires en cours | 10 s (non utilisée) |

- `/clanmap/changes` sans `since` répond 400.
- Les numéros d'événements ont des trous : 106 sur 1 641 811 événements.
- Quatre réponses 500 passagères sur environ 330 appels. La même requête réussit au nouvel essai.
- `/clanmap/changes` ne donne ni la date ni l'ancien propriétaire. Le rejeu retrouve l'ancien propriétaire, mais pas la date.

### Vérification du rejeu

L'historique rejoué depuis le début a été comparé pixel par pixel à l'instantané officiel :

| Route de l'historique | Instantané | Événements lus | Pixels comparés | Écart |
|---|---|---:|---:|---:|
| `/clanmap/changes` | n° 1 649 074 | 1 641 811 | 8 002 384 | **0** |
| `/clanmap/changes` | n° 1 654 095 | 1 646 033 | 8 002 384 | **0** |
| `/public/clanmap/history` | n° 1 785 861 (6 novembre) | 1 776 855 | 8 002 384 | **0** |

Le décompte de GAL (90 908 pixels à l'instantané n° 1 649 074) est identique à celui affiché par la carte du jeu. L'ordre des clans de tête aussi.

Le 6 novembre 2026, à 12 h 38 UTC, `/public/clanmap/history` a livré 1 781 713 événements :

- Les 1 656 206 événements déjà lus par `/clanmap/changes` la veille sont identiques.
- `previousClanId` ne contredit le rejeu sur aucun événement.
- Les 331 images complètes du film déjà publié n'ont pas changé.

Ces comparaisons à l'instantané ont été faites à la main. La collecte ne lit plus l'instantané : à chaque mise à jour, elle contrôle seulement `previousClanId`. Ce contrôle repère un événement manquant ou dans le désordre dès que son pixel rechange de main. Il ne verrait pas un événement manquant sur un pixel qui n'a plus bougé depuis.

### Qui peut quoi sur la carte

Lu dans le code de la page de la carte (`clanmap.openfront.io`) et du jeu, le 5 novembre 2026. Rien n'a été essayé avec un compte.

| Sujet | Constat |
|---|---|
| Peindre | Réservé au chef et aux officiers (`Only … leaders and officers can paint`). Il faut un pixel au contact du territoire, ou un navire. 100 pixels au plus par envoi, 3 navires en mer au plus. |
| Troupes | Achetées avec les capsules du trésor : `1 capsule = 100 troupes`. |
| Coût d'un pixel | Neutre : 1 000 troupes. Ennemi : `2 000 + ⌈troupes du clan ÷ pixels du clan⌉`. |
| Donner au trésor | Réservé aux membres (`POST /clans/:tag/donate`). Permanent et non remboursable. Le Plutonium est une monnaie payante : le site n'en parle pas et ne calcule rien avec. |
| Alimenter le trésor | Le schéma du jeu cite aussi une « part des victoires » du clan. **Son montant n'est écrit nulle part dans le dépôt public.** |

### Ce qui est public, et ce qui ne l'est pas

| Donnée | Route | Sans compte |
|---|---|---|
| Capsules, troupes et membres du clan | `GET /clans/GAL` | **Oui.** Le schéma du jeu précise que le trésor est une information publique. |
| Troupes de chaque clan | `GET /clanmap/ownership` | **Oui** |
| Dons au clan | `GET /clans/GAL/donations` | **Non : 401** |
| Top donateurs | `GET /clans/GAL/donations/leaderboard` | **Non : 401** |
| Mêmes routes sous `/public/clan/GAL/` | | **Non : 404** |
| Qui a peint quel pixel | Aucune route connue | **Rien ne le donne**, ni `/clanmap/changes`, ni `/clanmap/ships`, ni la route documentée |

**`/clans/GAL` n'a pas répondu à la collecte sur GitHub** le 6 novembre 2026, vers 13 h 04 UTC, alors qu'elle répondait une demi-heure plus tôt depuis une connexion personnelle. Le code d'erreur n'a pas été relevé : c'est peut-être le même refus que `/clanmap/ownership`. La collecte la réessaie une fois par jour, et la page écrit « Pas de données » pour les réserves.

**Conséquences pour le site :**

- **Le « joueur qui a le plus participé » à la carte n'est pas mesurable.** La page n'affiche donc aucun classement de peinture. Elle cite ceux qui peuvent peindre, sans dire qu'ils l'ont fait.
- **Le top donateurs ne peut pas être collecté.** Il faudrait le compte d'un membre, ce qui est exclu pour ce site. De plus, le jeu indique : « Les dons sont uniquement visibles aux yeux des membres du clan ». Le site passe donc par `content/carte-heros.json`, rempli à la main par le clan s'il choisit de le publier.
- **Le top des victoires reste public.** Il vient de `stats.team`, déjà affiché sur la page Membres.

### Licences

Le dépôt du jeu place le code sous AGPL-3.0 et le dossier `/resources` sous CC BY-SA 4.0, avec l'attribution « OpenFront ». `LICENSE-ASSETS` y inclut les données de carte.

**Le terrain de la carte des clans est la carte publique `resources/maps/giantworldmap/map.bin`.** Une version précédente de cet audit disait le contraire. Comparaison du 6 novembre 2026, au commit `641e462` du jeu, avec le terrain relevé la veille sur `/clanmap/terrain` :

- La terre est au même endroit sur les 8 002 384 cases, et le relief est identique sur toute la terre. Les deux fichiers ne sont pas identiques octet par octet : l'écart ne touche que des cases sans terre.
- Le manifeste de la carte annonce aussi 4 108 × 1 948 cases, dont 2 335 403 de terre.

La collecte lit donc ce fichier public pour compter la terre neutre au contact de GAL. Le fond du film en est une version réduite et assombrie, identifiée comme telle sur la page, avec sa source et sa licence. C'est ma lecture de ces licences : je ne peux pas trancher ce point juridiquement.

La page `/carte-monde/` copie de la même façon `resources/maps/world/manifest.json` et `map4x.bin` (commit `a0abccc`, 6 novembre 2026) : 1 000 × 500 cases, dont 158 068 de terre, le compte annoncé par le manifeste. Elle les dessine avec le code des couleurs et du dessin des territoires du client du jeu, repris sous AGPL-3.0 et modifié le 6 novembre 2026 (fichiers d'origine en tête de la page, ligne dans `NOTICE.md`), et affiche la source, les licences, la mention « © OpenFront and Contributors » et la non-affiliation.

Le dépôt ne contient ni les réserves des clans, ni leurs troupes : ces chiffres vivent sur les serveurs d'OpenFront. Le serveur de la carte des clans n'y est pas non plus : le code du jeu décrit sa page comme « served by infra ».

### Données personnelles

Le film ne contient que des tags, des couleurs et des troupes de clans, aucun joueur. Les noms complets des clans et le Plutonium ne sont pas conservés. Le film est toutefois fait de dessins peints par les joueurs, que le site ne filtre pas.

## 9. Vérifier les joueurs et lire les dons

Pour la connexion au site : voir [DIRECTION.md](DIRECTION.md). Testé le 5 novembre 2026. Le navigateur n'appelle aucune de ces routes. Les dons ne servaient qu'à la Conquête des Gaulois, retirée du site le 6 novembre 2026 : ces notes restent pour mémoire.

| Besoin | Route | État |
|---|---|---|
| Prouver qu'on possède un compte | `POST /public/identity_token/validate`, avec `token` et `audience` | **Documentée, mais réservée aux sites de la liste d'OpenFront** : `ofstats.io` et `trackerfront.io` à la lecture de `docs/API.md`. Il faut demander à son équipe d'ajouter le site. **Pas encore utilisée.** |
| Savoir qui est membre | `GET /public/clan/GAL/members?page=N&limit=50` | La route déjà utilisée par la collecte, non documentée. Lue sans erreur par la relecture quotidienne : 763 membres. |
| Lire les dons au clan | `GET /clans/GAL/donations`, `/donations/leaderboard` | **401 sans compte.** Aucune route de dons dans `docs/API.md`. Les mêmes routes sous `/public/clan/GAL/` répondent 404. |
| Total du trésor | `GET /clans/GAL`, champ `softBalance` | Public, mais global : il ne dit pas qui a donné. |

Le code du jeu (`packages/shared/src/ClanApiSchemas.ts`) confirme que ces listes séparent les capsules (`soft`) du Plutonium (`hard`), et qu'elles excluent la part des victoires. La somme des dons n'est donc pas le trésor.

**Conséquence : les dons ne peuvent pas être synchronisés** sans le compte d'un membre, ce que le projet exclut. Le site n'en lit aucun. Seule la page de la carte peut citer des donateurs, depuis une liste fournie par le clan (`content/carte-heros.json`).

**Vérifié de plus le 6 novembre 2026, quand la question du temps réel s'est posée :**

- **Depuis un navigateur :** la réponse CORS de `/clans/GAL/donations` n'autorise que `https://openfront.io`. Notre site ne peut pas l'appeler, même avec un compte.
- **Avec un compte, depuis un serveur :** la session d'un joueur repose sur un jeton court et un cookie de renouvellement (`src/client/Auth.ts`). Techniquement possible, mais [les conditions d'utilisation](https://openfront.io/terms-of-service.html) l'interdisent : la section 5 vise tout moyen automatisé que le service ne fournit pas.
- **Avec un script chez un officier :** la section 6.5 interdit tout script ou extension qui lit le client du jeu ou son trafic, quel que soit le but, sauf accord écrit d'OpenFront.

Le site ne fait donc ni l'un ni l'autre. Le trésor public (`softBalance` de `/clans/GAL`) ne permet pas d'attribuer un don : il bouge aussi avec les parts de victoire et les dépenses.

**Conséquence pour la vérification : la liste des membres ne prouve rien.** Elle est publique, donc n'importe qui peut y trouver le pseudo d'un membre. Le site s'en sert comme d'un contrôle, et un officier confirme.

D'après la documentation du jeu, un jeton d'identité dure 10 minutes, n'est valable que pour le site choisi, ne contient que le `publicId` et ne permet pas de se connecter à OpenFront.

**Ménager l'API :** la relecture de `scripts/relire-membres.ts` lit la liste au plus une fois par jour, en 16 appels espacés de 300 ms. Une liste incomplète ne remplace jamais la dernière liste valide. Le `publicId` est aussitôt remplacé par son empreinte : il n'entre jamais dans la base, ce qui respecte la règle de la section 7.

## 10. Message à envoyer à l'équipe d'OpenFront

À envoyer par vos soins, sur le canal que vous utilisez avec elle. Il est écrit en anglais, langue de la documentation du jeu. Si une version précédente est déjà partie, envoyez celle-ci en entier : l'ancienne citait une adresse du site qui n'existe plus, et un jeton d'identité n'est valable que pour le site choisi.

> Hello OpenFront team,
>
> I run the community site of the clan [GAL] Les Gaulois: https://les-gaulois.github.io/ (unofficial, not affiliated with OpenFront).
>
> Clan members can sign in on our site with Discord. Could you add our site to the identity token list (Account settings → Link to a third-party site), so that members can prove they own their account?
>
> Requested audience: `les-gaulois.github.io`
>
> How we would use it: our server validates the token once with `POST /public/identity_token/validate`, checks the public ID against `/public/clan/GAL/members`, then discards the token. We store neither the token nor the public ID, only a hash, and members without a public username stay anonymous.
>
> A question about the clan map. Our site builds its timelapse from your documented `/public/clanmap/history` and your Giant World Map, credited under CC BY-SA 4.0, thank you for both. Two things are not in the public API: each clan's troops (`/clanmap/ownership`) and a clan's treasury (`/clans/GAL`). `/clanmap/ownership` answered 403 from GitHub Actions, so we stopped reading it, and we will not try to get around that. Our reading of `/clans/GAL` fails from GitHub Actions too, so the site shows "no data" for the treasury; we still try once a day, and we will stop if you prefer. Would you consider public versions of these, or tell us if we may read them once a day?
>
> Thanks a lot for the game and for the public API!
