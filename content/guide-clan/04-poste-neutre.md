---
title: "Poste de défense et terrain neutre"
order: 4
---

Ces deux situations ne se jouent pas comme une attaque classique contre une tuile normale.

#### Poste de défense

| Élément | Valeur | Ce que ça veut dire |
|---|---|---|
| Portée | 30 tuiles | Le poste protège et agit dans cette portée. |
| Pertes de l'attaquant | ×5 | Une attaque contre le poste coûte beaucoup plus cher en pertes. |
| Coût de vitesse | ×3 | La prise de la tuile est ralentie. |

#### Territoire neutre

Un territoire neutre est une tuile qui n'appartient pas à un joueur. Le calcul est différent d'un combat de joueur contre joueur.

| Situation | Règle simple |
|---|---|
| Civil contre neutre | Les pertes utilisent mag ÷ 5. |
| Bot contre neutre | Les pertes utilisent mag ÷ 10. |
| Après la prise | La tuile devient votre territoire. |

> **À retenir.** Ne traitez pas une tuile neutre comme si elle avait un défenseur joueur : la logique et les pertes sont différentes.

<details>
<summary>Formules détaillées</summary>

**Vitesse en territoire neutre.** Elle dépend des troupes envoyées.

```
budget de tick = taille du front × 2
coût de la tuile = borne((2 000 × coût de tuile) ÷ troupes de l'attaque ; 5 ; 100)
part du tick = coût de la tuile ÷ budget de tick
```

**Fallout (retombées).** Ce modificateur s'applique au mag et au coût de tuile.

```
modificateur = 5 − 2 × ratio de fallout
```

</details>
