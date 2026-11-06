---
title: "Trains"
order: 8
---

Les Usines alimentent le réseau ferroviaire. Les Villes et les Ports servent d'arrêts commerciaux. Une Usine elle-même ne donne pas de paiement commercial à un train qui s'y arrête.

| Élément | À quoi ça sert |
|---|---|
| Usine | Crée des stations et participe au spawn des trains. |
| Réseau | Les stations sont reliées dans une portée de 15 à 110. |
| Ville ou Port | Arrêt commercial qui peut déclencher un paiement. |
| Train standard | Environ 7 unités : 1 moteur, 1 arrière et 5 wagons. |

#### Paiement par arrêt

| Relation | Or de base par arrêt |
|---|---|
| Self (vous-même) | 10 000 |
| Team (équipe) | 25 000 |
| Other (autre joueur) | 25 000 |
| Ally (allié) | 35 000 |

> **Attention.** Les 10 premiers arrêts commerciaux ne subissent pas de pénalité. À partir du 11e, le paiement baisse de 5 000 or par arrêt supplémentaire, avec un plancher à 5 000. Exemple chez un allié : 35k pendant 10 arrêts, 30k au 11e, 25k au 12e, et ainsi de suite.

> **Double revenu.** Quand un train visite la Ville ou le Port d'un autre joueur, le propriétaire du train et celui de la station reçoivent chacun le même paiement.

<details>
<summary>Formules détaillées</summary>

**Cadence (v0.35.12).** U est le nombre d'unités de train dans le monde, n le nombre de niveaux de vos Usines.

```
S(U) = max(1 − sigmoïde(U ; ln2/100 ; 560) ; 0,25 × (1 − sigmoïde(U ; ln2/150 ; 900)))
bonus(n) = 1 + 0,5 × borne((6 − n) ÷ 5 ; 0 ; 1) ÷ n
1 chance sur max(1 ; plancher((n + 10) × 15 ÷ (S(U) × bonus(n))))
```

**Saturation.** Elle devient importante autour de 560 unités de train, et un plateau d'environ 25 % est conservé dans la zone très élevée.

**Niveau.** Le code effectue un test de spawn pour chaque niveau de l'Usine : un niveau supérieur ajoute donc des occasions de spawn.

**Évolutions.** La v0.34.5 a accéléré les trains en milieu et fin de partie, la v0.34.12 a augmenté la cadence en début et milieu de partie, et la v0.35 accélère les joueurs qui ont peu d'Usines.

</details>
