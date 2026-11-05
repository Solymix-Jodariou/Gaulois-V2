# Design du site [GAL] Les Gaulois

## Intention

Gaming premium, sombre et net, construit à partir des logos du clan : un guerrier gaulois de profil, un casque à plumes tricolore, un arc bleu-blanc-rouge et un lettrage géométrique. Aucune référence à des personnages ou visuels protégés.

## Couleurs

Les jetons sont définis dans `src/styles/global.css`.

| Jeton | Valeur | Usage |
|---|---|---|
| `navy` | `#0A1230` | Fond |
| `surface` | `#121C3F` | Cartes |
| `surface-2` | `#1A2650` | État actif |
| `line` | `#2C3A6B` | Bordures |
| `blue` | `#0B5FFF` | Bouton principal, filet |
| `red` | `#FF1A2E` | Filet, marqueur de page et de ligne active |
| `white` | `#FFFFFF` | Texte, filet |
| `muted` | `#A9B4D0` | Texte secondaire |
| `blue-text` | `#8DB0FF` | Liens : le bleu du logo n'est pas assez contrasté sur le fond marine |
| `warn` | `#FFC857` | Données périmées et erreurs de collecte |

**Règle du tricolore :** uniquement en accent (filets de cartes, séparateurs, soulignement de la page active, loader). Jamais en aplat, et jamais de texte blanc sur le rouge, trop peu contrasté à petite taille.

## Typographie

- **Titres :** Outfit, sans-serif géométrique et grasse, proche du lettrage du logo.
- **Texte :** Inter.
- **Chiffres :** chiffres tabulaires (`.tnum`) pour que les colonnes s'alignent.
- Les polices sont servies par le site, sans requête vers un service tiers.

## Motifs

- **Filet tricolore :** sous-titre de page (`.tribar`) et bord supérieur des cartes clés (`.card-accent`), repris de la bande du logo.
- **Arc tricolore :** indicateur de chargement de la liste des membres.

## Logos

| Fichier | Où |
|---|---|
| Bannière | Haut de l'accueil, image de partage |
| Badge rond | En-tête, favicon recadré en cercle |

Le build en tire des versions légères dans `public/generated/`, et le site n'affiche que celles-ci. Les logos horizontal et vertical sont en réserve : non utilisés en V1. Les six fichiers d'origine sont conservés dans `brand-sources/`, dont une variante à contour et un logo horizontal à lettrage sombre, illisible sur le fond marine du site. Sans fichier dans `public/brand/`, le site affiche un lettrage provisoire.

La palette de départ a été comparée aux logos : le bleu `#0B5FFF` y correspond. Le rouge du logo est très proche et le fond de ses aplats un peu plus sombre que `#0A1230`. Ces écarts sont trop faibles pour modifier les jetons.

## Visualisation de données

- **Parties par jour :** barres empilées victoires et défaites, en bleu `#4C86F5` et orange `#D9742E`. Palette contrôlée sur la surface des cartes, y compris pour les daltonismes. Une légende et un tableau accompagnent le graphique.
- **Vue « Tout » :** regroupée par semaine, pour garder des barres lisibles en mobile.
- **Rang et score :** deux graphiques distincts, jamais de double axe. Le rang a l'axe inversé.
- **Heatmap :** une seule teinte, du sombre au clair, avec le nombre écrit dans chaque case. C'est un vrai tableau HTML. En dessous de 1 024 px, il pivote en une ligne par heure pour tenir sans défilement horizontal.
- **Période en cours :** barre plus pâle, signalée sous le graphique.

## Mouvement

Apparition légère des sections, compteurs de l'accueil et survols. Tout est désactivé avec `prefers-reduced-motion`, et les valeurs finales sont déjà dans le HTML.

## Accessibilité

- Lien d'évitement, focus visible partout, navigation entièrement utilisable au clavier.
- Graphiques doublés par des tableaux, identité jamais portée par la seule couleur.
- Tests automatiques axe (WCAG 2.1 A et AA) sur les 7 pages en desktop et mobile. Ces tests ne remplacent pas un essai avec un lecteur d'écran, qui n'a pas été fait.
- Absence de défilement horizontal testée à 375, 768, 1 280 et 1 920 px.

## États des données

| État | Affichage |
|---|---|
| Chargement | Arc animé, uniquement pour la liste des membres. Les autres pages arrivent déjà remplies. |
| Vide | « Pas de données », jamais un zéro |
| Zéro réel | « 0 » ; un taux sans partie affiche « — » |
| Erreur de collecte | Message jaune, dernières données valides conservées |
| Périmé | Message jaune calculé dans le navigateur du visiteur |
| Hors classement | Texte explicite, jamais un rang 0 |

## Évolutions prévues

Ces ajouts hors V1 restent possibles sans refonte :

- **Profils individuels :** les `publicId` des membres avec pseudo sont conservés.
- **Historique des parties :** les sessions sont déjà archivées avec leur `gameId`.
- **Comparateur :** le classement complet est conservé à chaque collecte.
- **Multilingue :** les textes sont dans les pages, ce qui demandera de les extraire.
