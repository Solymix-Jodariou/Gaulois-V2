# Licence et mentions

Site du clan [GAL] Les Gaulois.
Copyright (C) 2026 les contributeurs de ce site.

Le code de ce site est un logiciel libre : vous pouvez le redistribuer et le modifier selon les termes de la GNU Affero General Public License, version 3 uniquement (AGPL-3.0-only), publiée par la Free Software Foundation. Le texte complet est dans [LICENSE](LICENSE). Ce code est distribué sans aucune garantie, comme le précise cette licence.

Code source de la version en ligne : <https://github.com/Solymix-Jodariou/Gaulois-V2>

## Ce que la licence ne couvre pas

| Quoi | Où | Statut |
|---|---|---|
| Nom, tag, logos et images du clan | `public/brand/`, `brand-sources/` | Réservés au clan |
| Textes et listes du clan, dont le guide du clan | `content/`, sauf `content/guide/` | Réservés au clan |
| Stratégies par mode, traduites et adaptées du [wiki OpenFront](https://openfront.wiki/Main_Page) | `content/guide/` | CC BY-SA 4.0, attribution « OpenFront Wiki » : cette adaptation reste sous la même licence |
| Données collectées auprès d'OpenFront, dont le film de la carte des clans | `data/`, et leur copie publiée dans `public/generated/carte/` | © OpenFront et ses contributeurs |
| Fond de la carte des clans : Giant World Map d'OpenFront, réduite et assombrie | `data/clanmap/terrain.webp`, et sa copie publiée | CC BY-SA 4.0, attribution « OpenFront » : voir « Licences » dans `docs/API_AUDIT.md` |
| Terrain de la carte « World » d'OpenFront, copié tel quel (`manifest.json`, `map4x.bin`, commit `a0abccc` du 6 novembre 2026) | `public/carte-monde/` | CC BY-SA 4.0, attribution « OpenFront » : la page affiche sa source et sa licence |
| Code des couleurs du terrain et du dessin des territoires, repris du client d'OpenFront (commit `a0abccc`) et modifié le 6 novembre 2026 : fichiers d'origine listés en tête de la page | `public/carte-monde/index.html` | AGPL-3.0, avec les conditions de la section « OpenFront » ci-dessous |
| Relief et contours de la carte de la Conquête | `public/conquete/` | Tirés de Natural Earth, domaine public |
| Dépendances et polices | `package-lock.json` | Leur propre licence (polices Inter et Outfit : OFL-1.1) |

## OpenFront

Ce site est communautaire et non officiel : il n'a aucun lien avec les éditeurs d'OpenFront et n'a pas reçu leur approbation.

En dehors de ce que liste le tableau ci-dessus, aucun fichier de code ni aucune image d'OpenFront n'est copié ici à ce jour. Le calculateur et le graphique de croissance de `/debuter`, ainsi que les formules de la Conquête, sont adaptés de son code, lui-même sous AGPL-3.0, puis réécrits : voir `docs/API_AUDIT.md` et `docs/CONQUETE.md`. Le bas de page affiche la mention « © OpenFront and Contributors ».

Si un morceau de code d'OpenFront est repris :

- son fichier indique qu'il vient d'OpenFront, qu'il a été modifié, et à quelle date (section 5 de l'AGPL) ;
- les conditions supplémentaires de sa licence s'appliquent (section 7) : la mention « © OpenFront and Contributors » reste visible, l'origine du code n'est pas travestie, et le site ne prend pas OpenFront comme titre principal ni ne laisse croire à une approbation officielle. Texte d'origine : <https://github.com/openfrontio/OpenFrontIO/blob/main/LICENSE>.
