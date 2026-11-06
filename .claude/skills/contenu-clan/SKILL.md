---
name: contenu-clan
description: Modifie les textes et listes du clan — annonces, événements, outils communautaires, guides par mode, guide du clan, donateurs de la carte (content/) et fiche du clan (config/clan.ts) — avec les bons formats JSON et Markdown, sans rien inventer. À utiliser pour « ajouter une annonce », « un événement », « un chapitre », « changer la description du clan ».
paths:
  - "content/**"
  - "config/clan.ts"
---

# Contenu du clan

Ces fichiers parlent au nom du clan. Leur contenu vient du clan : un message de la personne qui pilote, le Discord, les PDF du Guide Gaulois. Tu mets en forme, tu corriges l'orthographe, tu ne rédiges pas de texte, de conseil de jeu, de date ni de nom à sa place. S'il manque une information, laisser la section vide (elle se masque seule) et le dire dans le rapport.

## Les fichiers

| Contenu | Fichier | Format |
|---|---|---|
| Annonces | `content/announcements.json` | `[{ "date": "2026-11-05", "title": "…", "body": "…", "url": "https://… (facultatif)" }]` |
| Événements | `content/events.json` | `[{ "start": "2026-11-20T20:00:00.000Z", "title": "…", "description": "… (facultatif)", "url": "https://… (facultatif)" }]` — `start` en UTC ; un événement passé disparaît au build suivant |
| Outils communautaires | `content/links.json` | `{ "tools": [{ "name": "…", "url": "https://…", "description": "…" }] }` |
| Guides par mode | `content/guide/*.md` | Markdown, en-tête `title`, `order`, `draft` (retirer `draft: true` pour publier), `wide` |
| Guide du clan | `content/guide-clan/NN-nom.md` | Markdown, en-tête `title`, `order`, `growthChart` (graphique calculé du chapitre 2, ne pas copier ailleurs), `wide` |
| Donateurs de la carte | `content/carte-heros.json` | `{ "updatedOn": "2026-11-05", "donors": [{ "player": "…", "caps": 1200 }], "highlights": [{ "title": "…", "player": "…", "detail": "… (facultatif)" }] }` |
| Fiche du clan | `config/clan.ts` | `description`, `history`, `values`, `entryConditions` ; `join.inviteOnly` et `checkedOn` relevés à la main dans le jeu |

Les schémas exacts sont dans `src/lib/schemas.ts` et `src/content.config.ts`. Un JSON invalide est ignoré au build : la section s'affiche vide et le build le signale dans ses journaux, sans échouer. Après chaque modification, contrôler avec `node -e "JSON.parse(require('fs').readFileSync('content/events.json','utf8'))"` puis `npm run build`, et lire les journaux.

## Règles

- Les annonces et événements publiés depuis `/direction` vivent dans Supabase et s'ajoutent à ceux de ces fichiers. Les deux voies restent valables.
- `content/guide/` adapte le wiki OpenFront (CC BY-SA 4.0) : réécrire, ne pas copier, et garder la mention de licence sur la page `/debuter`. Quand le wiki et le code public du jeu divergent, le code tranche. `content/guide-clan/` est au clan, tous droits réservés.
- Donateurs : seulement une liste fournie par le clan, qui a décidé de la publier. Capsules uniquement, jamais de montant en argent, jamais de renvoi vers le Plutonium.
- Pas de référence à Astérix, pas d'emoji dans les textes du site.

## Les tests qui comptent

`tests/e2e/site.spec.ts` vérifie le nombre de fiches (`guide-card`, 5 aujourd'hui) et de chapitres (`guide-chapter`, 11) sur `/debuter`, et l'adresse du Discord. Ajouter un guide ou changer un lien demande de mettre ces valeurs à jour dans le test, puis `verifier`.
