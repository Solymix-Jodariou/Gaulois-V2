# Site du clan [GAL] Les Gaulois

Site communautaire du clan [GAL] sur [OpenFront](https://openfront.io/). Site non officiel, sans lien avec les éditeurs d'OpenFront.

Le site est statique (Astro). Une GitHub Action récupère les données de l'API toutes les heures et reconstruit le site. Les visiteurs n'appellent jamais l'API.

- Audit de l'API : [docs/API_AUDIT.md](docs/API_AUDIT.md)
- Choix de design : [docs/DESIGN.md](docs/DESIGN.md)

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
| `npm run build` | Génère le favicon et l'image de partage, puis construit `dist/` |
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
| `banner` | Haut de l'accueil et image de partage |
| `badge` | En-tête et favicon (recadré en cercle) |
| `logo-horizontal`, `logo-vertical` | Non utilisés pour l'instant |

Pour changer de version, remplacez le fichier sous le même nom : le prochain build en tire des images légères (`npm run brand`). Sans ces fichiers, le site affiche un lettrage provisoire. Les six originaux sont conservés dans `brand-sources/`, qui n'est pas publié.

### L'environnement : `.env.example`

`SITE_URL` et `BASE_PATH` ne servent qu'à construire les liens. Sur GitHub Pages, l'Action les renseigne seule.

## Mettre à jour les contenus

Tout se modifie depuis GitHub, sans outil particulier. L'enregistrement relance la construction du site.

| Contenu | Fichier | Format |
|---|---|---|
| Annonces | `content/announcements.json` | `[{ "date": "2026-11-05", "title": "…", "body": "…", "url": "https://… (facultatif)" }]` |
| Événements | `content/events.json` | `[{ "start": "2026-11-20T20:00:00.000Z", "title": "…", "description": "… (facultatif)", "url": "https://… (facultatif)" }]` |
| Outils communautaires | `content/links.json` | `{ "tools": [{ "name": "…", "url": "https://…", "description": "…" }] }` |
| Guides par mode | `content/guide/*.md` | Markdown |

Pour publier un guide, écrivez le texte dans le fichier, puis retirez la ligne `draft: true` en tête. Un événement passé disparaît au build suivant. Un fichier JSON au mauvais format est ignoré : la section s'affiche alors comme vide, et le build le signale dans ses journaux.

## Les données

Tout est écrit dans `data/` :

| Fichier | Contenu | Fréquence |
|---|---|---|
| `leaderboard.json` | Classement officiel | Chaque heure |
| `sessions/AAAA-MM.json` | Sessions du clan, sans doublon | Chaque heure |
| `members.json` | Membres et leurs stats d'équipe | Une fois par jour |
| `history/AAAA-MM-JJ.json` | Instantané quotidien : rang, score, totaux | Chaque heure, dernière valeur du jour conservée |
| `meta.json` | Date du dernier succès et dernière erreur de chaque jeu de données | Chaque heure |

Si l'API échoue ou si une réponse ne passe pas la validation Zod, les derniers fichiers valides sont conservés, l'erreur est notée dans `meta.json` et le site l'affiche. Si la collecte s'arrête entièrement, le navigateur du visiteur signale les données périmées : au bout de 4 h pour le classement et les sessions, 36 h pour les membres.

Tous les calculs sont dans `src/lib/` et testés :

- **Rang :** position dans la liste de l'API, sans recalcul.
- **Score :** champ `weightedWins` de l'API.
- **Taux de victoire :** `victoires ÷ parties`. Sans partie, il n'y a pas de taux.
- **Écart avec un voisin :** différence de `weightedWins`.
- **Stats d'un membre :** champ `stats.team` de l'API.
- **Meilleurs créneaux :** les plus de parties sur 90 jours, puis les plus de joueurs du clan par partie. Un créneau sous 5 parties est écarté.

Le calculateur de troupes est documenté dans `src/lib/calculator.ts`. Il reprend les constantes du jeu au commit `5b75bd3`. **Si le jeu change ses règles d'attaque, il faut les mettre à jour à la main.**

## Déploiement sur GitHub Pages

Rien n'est déployé tant que vous ne faites pas ces étapes. L'offre gratuite de GitHub Pages demande un dépôt public.

1. Créez un dépôt GitHub public et poussez le projet sur la branche `main`.
2. Dans **Settings → Pages**, choisissez **GitHub Actions** comme source.
3. Dans **Actions**, lancez **Données et site** une première fois.

Le workflow `.github/workflows/site.yml` tourne ensuite chaque heure, à chaque push sur `main` et à la demande. GitHub peut retarder les exécutions planifiées, et il peut désactiver celles d'un dépôt qu'il juge inactif : si les données se figent, regardez l'onglet **Actions**.

## Limites connues

- La route de la liste des membres n'est pas documentée par OpenFront et peut changer. En cas de panne, le site garde la dernière liste valide.
- Le passé du rang et du score n'existe pas dans l'API : ces courbes partent du premier instantané.
- Le classement couvre 90 jours glissants : ce ne sont pas des totaux depuis la création du clan.
