---
title: "Bateaux de trade"
order: 7
---

Un bateau de trade relie deux Ports compatibles. La distance influence fortement le paiement.

1. **Départ :** le Port source doit pouvoir lancer le commerce.
2. **Trajet :** le bateau parcourt la distance entre les Ports.
3. **Arrivée :** le paiement dépend de la distance et du multiplicateur d'or.

#### Repères de paiement, avant multiplicateur

| Distance | Or approximatif |
|---|---|
| 100 | 5 185 |
| 200 | 13 557 |
| 300 | 52 500 |
| 400 | 91 443 |
| 500 | 99 815 |
| 750 | 112 500 |
| 1 000 | 125 000 |

> **Paiement.** À l'arrivée d'un bateau non capturé, le Port source et le Port de destination reçoivent chacun le même montant.

> **Piraterie.** Si le bateau a été capturé, son propriétaire au moment de l'arrivée reçoit le paiement comme revenu de piraterie.

Le nombre mondial de bateaux ralentit progressivement les nouveaux spawns : c'est la saturation.

> **Mise à jour v0.35.** Les premiers Ports font apparaître les bateaux plus vite : avec un seul Port, comptez environ 8 s entre deux bateaux, contre 12 s auparavant. Cela concerne la cadence, pas le paiement à chaque arrivée.

<details>
<summary>Formules détaillées</summary>

**Spawn.** Le Port vérifie le spawn toutes les 10 ticks, soit chaque seconde. Chaque niveau du Port ajoute une tentative lors du contrôle.

**Destination.** Il faut un autre Port compatible : commerce autorisé et zone d'eau accessible depuis le Port source.

**Revenu.** Le seuil de courte portée vaut 300 : la distance pèse fortement autour de cette zone.

```
or = (75 000 ÷ (1 + e^(−0,03 × (distance − 300))) + 50 × distance) × multiplicateur d'or
```

**Saturation et cadence (v0.35.12).** T est le nombre de bateaux de trade dans le monde, n le nombre de niveaux de vos Ports.

```
S(T) = max(1 − sigmoïde(T ; ln2/50 ; 330) ; 0,25 × (1 − sigmoïde(T ; ln2/100 ; 800)))
bonus(n) = 1 + 0,5 × borne((6 − n) ÷ 5 ; 0 ; 1) ÷ n
1 chance sur max(1 ; plancher((100 ÷ bonus(n)²) ÷ (refus + 1) ÷ S(T)))
```

Lecture simple : les petites économies reçoivent un bonus, qui s'efface à 6 niveaux, puis une saturation progressive s'installe quand la flotte mondiale grossit. Un plateau bas subsiste dans la zone très élevée. Après des refus successifs, la chance de spawn augmente.

</details>
