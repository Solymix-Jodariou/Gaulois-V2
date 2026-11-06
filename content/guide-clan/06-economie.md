---
title: "Économie : gagner et dépenser son or"
order: 6
---

L'économie de base repose sur des revenus passifs, les bateaux de trade, les trains, la conquête et certaines captures ou droits commerciaux.

| Source | Règle simple | Ordre de grandeur |
|---|---|---|
| Revenu passif, Civil | 100 or / tick | 60 000 or / min |
| Revenu passif, Bot | 50 or / tick | 30 000 or / min |
| Conquête d'un Civil | 50 % de son or restant | Selon l'or restant sur la cible |
| Conquête d'un Bot ou d'une Nation | 100 % de l'or restant | Selon l'or restant sur la cible |

#### Les bâtiments principaux

| Bâtiment | Utilité | Coût |
|---|---|---|
| Ville | Plus de capacité de troupes, et arrêt commercial pour les trains. | 125k → 250k → 500k → 1M |
| Port | Commerce maritime et bateaux de trade. | Même progression, compteur partagé avec l'Usine |
| Usine | Réseau ferroviaire et création des trains. | Même progression, compteur partagé avec le Port |

Le coût des structures augmente avec le nombre déjà compté : la Ville a son propre compteur, le Port et l'Usine partagent le même.

> **Orientation.** Pour un débutant : commencez par sécuriser votre économie et votre territoire avant de chercher à optimiser chaque formule de spawn.

> **Mise à jour.** Depuis la v0.34.0, l'or est plus généreux en début de partie, puis ralentit en milieu et en fin de partie. Les 100 et 50 or par tick restent les bases, avant multiplicateur.

<details>
<summary>Détails et formules</summary>

**Revenu passif.** Il est fixe par tick, sans nombre de travailleurs, puis multiplié par le multiplicateur d'or de la partie. Ce multiplicateur s'applique aussi aux paiements du commerce ferroviaire et maritime.

**Coût des bâtiments.** Pour n structures déjà comptées :

```
coût(n) = min(1 000 000 ; 125 000 × 2^n)
```

**Niveaux.** Chaque niveau du Port augmente les tentatives de spawn d'un bateau lors d'un contrôle. L'Usine crée sa station ferroviaire et participe au calcul de la cadence des trains. Bateaux de trade et trains ne coûtent rien directement : ils sont générés par leurs systèmes.

**Statistiques.** Les statistiques du joueur distinguent notamment les revenus de bateaux de trade, de trains, de piraterie, de conquête et d'autres sources.

**Don d'or.** Quand il est activé, il transfère de l'or existant d'un joueur vers un autre. Ce n'est pas une création nette d'or.

**Embargo.** Les systèmes commerciaux exigent une destination éligible. Un embargo peut donc empêcher un commerce avec une cible.

</details>
