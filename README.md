# Site du clan [GAL] Les Gaulois

Site communautaire du clan [GAL] sur [OpenFront](https://openfront.io/). Site non officiel, sans lien avec les éditeurs d'OpenFront.

Le site est statique (Astro). Une GitHub Action récupère les données de l'API toutes les heures et reconstruit le site. Les visiteurs n'appellent jamais l'API.

- Audit de l'API : [docs/API_AUDIT.md](docs/API_AUDIT.md)
- Choix de design : [docs/DESIGN.md](docs/DESIGN.md)
- Connexion Discord, rôles et espace Direction, seule partie avec un serveur : [docs/DIRECTION.md](docs/DIRECTION.md)

## Installation

Il faut Node.js 22 ou plus.

```bash
npm install
```

```bash
npm run dev
```

Le site s'ouvre sur http://localhost:4321. Aucun secret n'est nécessaire.

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run data:fetch` | Collecte les données dans `data/` |
| `npm run data:carte` | Met à jour seulement la carte des clans, sans attendre le délai d'une journée |
| `npm run membres:relire` | Relit la liste des membres pour la connexion. Sans ses réglages, elle ne fait rien. |
| `npm run verifier:ligne` | Contrôle le vrai projet Supabase, sans rien y écrire : voir [docs/DIRECTION.md](docs/DIRECTION.md) |
| `npm run build` | Génère le favicon, l'image de partage et les fichiers du film, puis construit `dist/` |
| `npm run preview` | Sert le dossier `dist/` |
| `npm run lint` | ESLint |
| `npm run typecheck` | `astro check` et `tsc` |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Parcours, accessibilité et largeurs d'écran (Playwright). À lancer après `npm run build`. |

Pour les tests Playwright, installez une première fois le navigateur :

```bash
npx playwright install chromium
```

## Configuration

### Le clan : `config/clan.ts`

Le tag, le nom, les liens et les noms des logos s'y trouvent. Les valeurs à remplir sont à `null` ou `[]`, et leur section reste masquée tant qu'elles sont vides :

| Champ | Affiché sur |
|---|---|
| `description` | Accueil |
| `history`, `values`, `entryConditions` | Rejoindre |

`join.inviteOnly` indique si le clan est sur invitation. Cette valeur a été relevée à la main le 5 novembre 2026 et ne se met pas à jour seule : à modifier si le clan change de statut dans le jeu.

`archiveStart` fixe le début de la progression, le 10 avril 2026, date de création du clan dans le jeu. Il est lu lors de la première collecte, celle qui reprend tout l'historique. Pour le reculer, supprimez aussi `data/meta.json` et `data/sessions/`, puis relancez la collecte.

### Les logos : `public/brand/`

Déposez les fichiers sous ces noms, en `.svg`, `.webp`, `.png`, `.jpg` ou `.jpeg` :

| Fichier | Utilisation |
|---|---|
| `banner` | Bas de l'accueil et image de partage |
| `logo-vertical` | Grand visuel de l'accueil et de la page Rejoindre |
| `badge` | En-tête et favicon (recadré en cercle) |
| `logo-horizontal` | Non utilisé pour l'instant |

Pour changer de version, remplacez le fichier sous le même nom : le prochain build en tire des images légères (`npm run brand`). Sans ces fichiers, le site affiche un lettrage provisoire. Les six originaux sont conservés dans `brand-sources/`, qui n'est pas publié.

### L'environnement : `.env.example`

`SITE_URL` et `BASE_PATH` ne servent qu'à construire les liens. Sur GitHub Pages, l'Action les renseigne seule.

Les autres valeurs ne concernent que la connexion Discord : voir [docs/DIRECTION.md](docs/DIRECTION.md). Sans elles, la connexion n'apparaît pas et le site reste entièrement statique.

## Mettre à jour les contenus

Tout se modifie depuis GitHub, sans outil particulier. L'enregistrement relance la construction du site.

| Contenu | Fichier | Format |
|---|---|---|
| Annonces | `content/announcements.json` | `[{ "date": "2026-11-05", "title": "…", "body": "…", "url": "https://… (facultatif)" }]` |
| Événements | `content/events.json` | `[{ "start": "2026-11-20T20:00:00.000Z", "title": "…", "description": "… (facultatif)", "url": "https://… (facultatif)" }]` |
| Outils communautaires | `content/links.json` | `{ "tools": [{ "name": "…", "url": "https://…", "description": "…" }] }` |
| Guides par mode | `content/guide/*.md` | Markdown |
| Guide du clan, chapitre par chapitre | `content/guide-clan/*.md` | Markdown |
| Donateurs de la carte | `content/carte-heros.json` | `{ "updatedOn": "2026-11-05", "donors": [{ "player": "…", "caps": 1200 }], "highlights": [{ "title": "…", "player": "…", "detail": "… (facultatif)" }] }` |

**Les donateurs se recopient à la main.** Le jeu les réserve aux membres du clan : fiche de [GAL], onglet « Dons », puis « Top donateurs ». Aucune route publique ne les donne, et le site n'utilise aucun compte. Publier ces noms rend publique une information que le jeu garde entre membres : c'est au clan d'en décider. Tant que le fichier est vide, la page n'affiche aucun nom et renvoie vers le jeu.

Pour publier un guide, écrivez le texte dans le fichier, puis retirez la ligne `draft: true` en tête. Un événement passé disparaît au build suivant. Un fichier JSON au mauvais format est ignoré : la section s'affiche alors comme vide, et le build le signale dans ses journaux.

**D'où viennent les guides de `/debuter`.** Le guide du clan reprend les deux PDF Guide Gaulois d'octobre 2026. Les fiches par mode viennent du [wiki OpenFront](https://openfront.wiki/Main_Page), sous licence CC BY-SA 4.0 : garder sa mention sous la section, et réécrire plutôt que copier (voir `NOTICE.md`). Ce wiki a des pages périmées : quand deux sources divergent, c'est le code public du jeu qui tranche. Le graphique du chapitre 2 est calculé par `src/lib/growth.ts`, il ne se modifie pas à la main.

## Les données

Tout est écrit dans `data/` :

| Fichier | Contenu | Fréquence |
|---|---|---|
| `leaderboard.json` | Classement officiel | Chaque heure |
| `sessions/AAAA-MM.json` | Sessions du clan, sans doublon | Chaque heure |
| `members.json` | Membres et leurs stats d'équipe | Une fois par jour |
| `history/AAAA-MM-JJ.json` | Instantané quotidien : rang, score, totaux | Chaque heure, dernière valeur du jour conservée |
| `rivals/AAAA-MM-JJ.json` | Tags et scores de tout le classement du jour, dans l'ordre officiel | Chaque heure, dernière valeur du jour conservée |
| `ranked.json` | Par mode classé : places lues, membres avec pseudo sur ces places, et combien dans les 10 premières. Aucun nom ni chiffre individuel | Chaque heure |
| `games/AAAA-MM.json` | Pour chaque partie du clan : carte, durée, équipe gagnante, et tag, nombre de joueurs et équipe des clans d'au moins 2 joueurs. Aucun joueur | Chaque heure, 400 parties au plus par passage, jamais relues |
| `clanmap/film.bin`, `clanmap/film.json` | Film de la carte des clans : changements de cases et chiffres de chaque image | Une fois par jour |
| `clanmap/terrain.webp` | Fond de carte, tiré de Giant World Map d'OpenFront (CC BY-SA 4.0) | Une seule fois |
| `clanmap/journal.json` | Un relevé par jour : pixels, rang, capsules et troupes de GAL | Une fois par jour |
| `meta.json` | Date du dernier succès et dernière erreur de chaque jeu de données | Chaque heure |

Si l'API échoue ou si une réponse ne passe pas la validation Zod, les derniers fichiers valides sont conservés, l'erreur est notée dans `meta.json` et le site l'affiche. Si la collecte s'arrête entièrement, le navigateur du visiteur signale les données périmées : au bout de 4 h pour le classement et les sessions, 36 h pour les membres et la carte.

### La carte des clans

La carte vient de `/public/clanmap/history`, la route documentée par OpenFront pour construire ce genre de film. L'historique brut ne va pas dans Git : il pèse déjà environ 30 Mo. Il reste dans `.cache/clanmap/`, conservé entre deux exécutions par le cache de l'Action. S'il est perdu, la collecte suivante le retélécharge entièrement, soit plus de 350 appels à ce jour, et sur GitHub elle le fait sans attendre le délai d'une journée. Chaque page lue est gardée, donc une panne en cours de route ne fait pas tout recommencer.

À chaque mise à jour, tout l'historique est rejoué. Chaque événement annonce l'ancien propriétaire du pixel, et le rejeu doit retomber dessus. Au moindre écart, le film n'est pas remplacé et l'erreur s'affiche sur la page. Si OpenFront remet un jour sa carte à zéro, il faudra supprimer le cache `clanmap-…` dans l'onglet **Actions → Caches** pour repartir de son nouvel historique.

Le terrain est la carte publique Giant World Map, dans le dépôt du jeu, sous licence CC BY-SA 4.0 avec l'attribution « OpenFront » : `resources/maps/giantworldmap/map.bin`, fixé à un commit dans `src/lib/clanmap/terrain.ts`. La collecte le garde dans le même cache et s'en sert pour compter la terre neutre au contact de GAL. S'il ne répond pas, ou si sa surface de terre n'est plus celle de `OFFICIAL_MAP`, le film reste valable et ce chiffre disparaît de la page. Le fond de carte `terrain.webp` en est une version réduite et assombrie : la page cite sa source et sa licence, et ces mentions doivent rester. Si OpenFront change son terrain, il faudra refaire le fond et le commit à la main.

La page `/carte-monde/` est à part : une page HTML autonome dans `public/carte-monde/`, sans la mise en page du site, qui dessine la carte « World » du jeu dans un canvas à partir de `manifest.json` et `map4x.bin`, copiés du dossier `resources/maps/world` du dépôt d'OpenFront (CC BY-SA 4.0, attribution « OpenFront », commit noté dans la page). Son code des couleurs du terrain et du dessin des territoires est repris du client d'OpenFront (AGPL-3.0), signalé et daté en tête de la page et dans `NOTICE.md`. Sa fonction `paintTerritory` colorie un territoire de clan par remplissage sur la terre seulement, comme le jeu dessine un territoire : intérieur translucide, bord plus foncé. Le territoire affiché aujourd'hui est un exemple à la taille arbitraire, signalé comme tel : il attend d'être branché sur les chiffres du clan.

Le film compte 480 images au plus, 5 000 événements par image pour l'instant. Cette taille ne double que si le film devient trop long. Les images déjà écrites ne changent donc pas d'un jour à l'autre, et `film.bin` reste non compressé pour que Git ne stocke presque que les nouvelles. Le fichier est déclaré binaire dans `.gitattributes`, sans quoi Git pourrait le corrompre sous Windows.

Tous les calculs sont dans `src/lib/` et testés :

- **Rang :** position dans la liste de l'API, sans recalcul.
- **Score :** champ `weightedWins` de l'API.
- **Taux de victoire :** `victoires ÷ parties`. Sans partie, il n'y a pas de taux.
- **Écart avec un voisin :** différence de `weightedWins`.
- **Stats d'un membre :** champ `stats.team` de l'API.
- **Meilleurs créneaux :** les plus de parties sur 90 jours, puis les plus de joueurs du clan par partie. Un créneau sous 5 parties est écarté.
- **Jeu en groupe :** `victoires ÷ parties` selon `clanPlayerCount`, sur toutes les sessions archivées. Une taille sous 30 parties est écartée. Le bloc disparaît si la plus grande taille retenue ne gagne pas plus que la plus petite.
- **Course avec les voisins :** score de GAL moins celui du clan voisin, sur chaque relevé de `data/rivals/`. Voisins : le clan au-dessus et les deux en dessous dans le dernier classement. Un clan absent d'un relevé laisse un trou, pas un zéro.
- **Joueurs au classé :** `/public/leaderboard/ranked`, pages 1 et 2, croisé avec les membres avec pseudo par `publicId`. Le site n'écrit que des décomptes par mode : les stats publiées d'un membre restent `stats.team`, or le classé peut venir de parties jouées hors du tag. Ces décomptes restent à part des stats de clan.
- **Résultats par format :** `victoires ÷ parties` selon `playerTeams`, sur 90 jours et depuis le début de l'archive. Un format sous 30 parties sur 90 jours est écarté. Le repère de hasard est la moyenne de `1 ÷ numTeams` sur ces parties. Les parties jouées seul contre des robots y restent : 11 sur plus de 13 000 au 7 novembre 2026.
- **Records du clan :** plus longue série de victoires (par heure de début), journée de Paris avec le plus de victoires, plus de joueurs du clan et plus d'équipes dans une partie gagnée. Une partie où `totalPlayerCount` vaut moins de 2 est écartée : seul contre des robots, elle fausserait les records. Il n'y a pas de record de score pour cette raison : ces parties y arrivaient en tête.
- **Résultats par carte de jeu :** `victoires ÷ parties` selon `info.config.gameMap` de `/public/game/:id`, sur 90 jours, et depuis le début de l'archive une fois qu'il reste au plus 20 parties à lire. Une carte sous 50 parties sur 90 jours est écartée, comme les parties seul contre des robots. Les cartes sont triées de la plus à la moins jouée. La durée est la médiane de `info.duration`.
- **Carte forte ou faible :** le taux d'une carte ne se compare ni aux autres cartes ni au hasard : le format, la taille du salon et le nombre de joueurs du clan pèsent davantage, et les deux premiers changent d'une carte à l'autre. Le taux « d'habitude » d'une carte est la moyenne, sur ses parties, du taux du clan sur la période pour le même `playerTeams`, le même `clanPlayerCount` (1, 2, 3, ou 4 et plus) et un `totalPlayerCount` de la même tranche (jusqu'à 20, 40 ou 80, ou plus). Avec `p` ce taux pour chaque partie, l'écart vaut `(victoires − Σp) ÷ √Σp(1−p)`. Une carte n'est dite forte ou faible qu'à 4 ou plus dans un sens ou dans l'autre. Le 7 novembre 2026, sur 3 060 parties, aucune n'atteignait même 3. Mesures : section « Détail d'une partie » de [docs/API_AUDIT.md](docs/API_AUDIT.md).
- **Équipe d'un clan dans une partie :** l'API ne donne pas encore l'équipe des perdants, et sa liste de vainqueurs oublie ceux partis avant la fin. `placeClans` applique donc la règle du jeu : tout le clan dans une seule équipe, le plus gros clan d'abord, dans l'équipe la moins remplie. Si une fiche de joueur donne son équipe (`team`), elle remplace ce calcul. Si le résultat contredit un vainqueur officiel ou la session, la partie est écartée des face-à-face.
- **Face-à-face :** parties où GAL et un clan de la liste officielle avaient chacun au moins 2 joueurs avec des stats, dans des équipes différentes, sur 90 jours : gagnées par l'équipe de GAL, par celle de l'autre clan, ou par une troisième. Un clan rencontré moins de 30 fois est écarté, et la liste s'arrête à 12 clans. Au-delà de 5 % de parties écartées parmi les 200 dernières du clan à 2 joueurs ou plus, les chiffres sont suspendus : la règle du jeu a peut-être changé.
- **Ma place :** position d'un membre parmi ceux dont les stats sont connues, triés par `stats.team.wins`, comme la page Membres. Deux membres à égalité partagent la même place.
- **Territoire sur la carte :** pixels rejoués depuis l'historique. L'ordre des clans suit le nombre de pixels, comme la liste de la carte officielle. Ce n'est pas le classement des clans.
- **Pixels pris et perdus :** comptés à chaque changement de main d'un pixel. Les terres neutres sont comptées à part.
- **Objectif :** pixels du clan juste devant, moins ceux de GAL, plus 1.
- **Coûts de la carte :** 1 capsule = 100 troupes, 1 pixel neutre = 1 000 troupes, 1 pixel ennemi = 2 000 troupes et plus selon les troupes du clan visé. Règles lues dans le code de la carte, dans `src/lib/clanmap/economy.ts`. **Si le jeu les change, il faut les mettre à jour à la main.**
- **Grands moments du film :** déduits des chiffres de chaque image dans `src/lib/clanmap/moments.ts`, sans texte écrit à la main.

Le calculateur de troupes est documenté dans `src/lib/calculator.ts`. Il reprend les constantes du jeu au commit `5b75bd3`. **Si le jeu change ses règles d'attaque, il faut les mettre à jour à la main.**

## Déploiement sur GitHub Pages

Le site est publié sur <https://les-gaulois.github.io/>. Cette adresse vient du nom du dépôt : un dépôt nommé `les-gaulois.github.io`, dans l'organisation GitHub `les-gaulois`, publie à la racine de cette adresse. Ne pas le renommer : l'adresse du site changerait, sans renvoi automatique depuis l'ancienne.

Les anciens liens, en `solymix-jodariou.github.io/Gaulois-V2/`, passent par un petit dépôt à part, [`Solymix-Jodariou/solymix-jodariou.github.io`](https://github.com/Solymix-Jodariou/solymix-jodariou.github.io), qui envoie vers la même page du site. Ne pas le supprimer : ces liens casseraient.

Pour réinstaller le site ailleurs, rien n'est déployé tant que vous ne faites pas ces étapes. L'offre gratuite de GitHub Pages demande un dépôt public.

1. Créez un dépôt GitHub public et poussez le projet sur la branche `main`.
2. Dans **Settings → Pages**, choisissez **GitHub Actions** comme source.
3. Dans **Actions**, lancez **Données et site** une première fois.

Le workflow `.github/workflows/site.yml` tourne ensuite chaque heure, à chaque push sur `main` et à la demande. GitHub peut retarder les exécutions planifiées, en sauter, et désactiver celles d'un dépôt qu'il juge inactif. Depuis le 6 novembre 2026, une tâche de [cron-job.org](https://cron-job.org) nommée « Collecte GAL » lance donc le workflow à la minute 53 de chaque heure, avec un jeton GitHub qui ne doit donner que le droit **Actions** sur ce dépôt. S'il expire ou s'il est supprimé, la collecte retombe sur le seul planning de GitHub. Si les données se figent, regardez l'onglet **Actions**, puis cette tâche et la date de son jeton dans les réglages du compte GitHub.

## La connexion Discord

Les membres se connectent avec Discord, un officier valide leur compte, et l'encadrement publie annonces et événements depuis `/direction`. C'est la seule partie du site qui a un serveur et une base de données (Supabase), **branchée à un vrai projet depuis le 6 novembre 2026** : voir [docs/DIRECTION.md](docs/DIRECTION.md). Le reste du site n'en dépend pas et continue de marcher si elle tombe.

**La Conquête des Gaulois, un jeu de territoires, a été retirée du site le 6 novembre 2026. Ses tables restent dans le projet Supabase en ligne, inutilisées, et ses fichiers déjà appliqués restent dans `supabase/migrations/`, jusqu'à ce que le clan s'en occupe.** Le fichier `config/conquete.json` reste lui aussi, sans plus servir.

## Animations

Les effets au curseur et aux clics sont dans `src/scripts/fx.ts`. Ils sont décrits dans [docs/DESIGN.md](docs/DESIGN.md). Les visiteurs peuvent les couper avec le bouton pause de l'en-tête ou le réglage « réduire les animations » de leur système.

## Limites connues

- La route de la liste des membres n'est pas documentée par OpenFront et peut changer. En cas de panne, le site garde la dernière liste valide.
- Le passé du rang et du score n'existe pas dans l'API : ces courbes partent du premier instantané. Celles des clans voisins partent du premier fichier de `data/rivals/`.
- Le classement classé ne reconnaît que les membres avec un pseudo public : les chiffres affichés sont donc des minimums. Il ne dit pas non plus sous quel tag ces parties ont été jouées.
- Le classement couvre 90 jours glissants : ce ne sont pas des totaux depuis la création du clan.
- Le détail des parties se lit petit à petit, des plus récentes aux plus anciennes : les pages disent combien sont lues, et les totaux depuis le début n'apparaissent qu'à la fin de cette lecture. Une partie qui ne répond pas reste à lire : rien de définitif n'est écrit. Après 25 échecs dans un passage, ou 5 sans aucune partie lue, la page signale une panne. Les équipes des clans sont retrouvées par calcul tant que les fiches ne les donnent pas : si OpenFront change sa façon de les former, il faudra adapter `placeClans`.
- La route documentée de la carte ne donne pas les troupes des clans. Le site n'affiche donc pas le coût exact d'un pixel ennemi. Le message prévu pour OpenFront, à la section 10 de [docs/API_AUDIT.md](docs/API_AUDIT.md), demande cette donnée.
- Le trésor vient de `/clans/GAL`, une route non documentée. Elle n'a pas répondu à la collecte sur GitHub le 6 novembre 2026 : la page écrit donc « Pas de données » pour les réserves du clan.
- Le film ne filtre pas les dessins peints par les joueurs sur la carte.
- Le jeu ne publie pas qui a peint quel pixel : le site ne peut classer personne pour sa peinture.
- De la connexion, seules la connexion Discord d'un compte et la désignation du fondateur ont été essayées en vrai. Il n'y a plus de test automatique des droits côté serveur : voir [docs/DIRECTION.md](docs/DIRECTION.md).
- Les parcours décrits dans « Comment participer » viennent du code du jeu et n'ont pas été essayés avec un compte. Le texte devra être relu par un membre du clan.

## Licence

Le code est sous [AGPL-3.0-only](LICENSE). [NOTICE.md](NOTICE.md) liste ce que la licence ne couvre pas (nom, logos et textes du clan, données d'OpenFront) et les conditions à respecter si du code d'OpenFront est repris.
