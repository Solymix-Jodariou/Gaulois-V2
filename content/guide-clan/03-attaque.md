---
title: "Comprendre une attaque"
order: 3
---

Pour comprendre un combat, regardez surtout quatre choses :

- **Ratio :** défenseur ÷ attaque. Une grosse attaque fait baisser ce ratio.
- **Densité :** troupes du défenseur ÷ nombre de tuiles défendues.
- **Terrain :** plaine, highland (colline) et montagne n'ont pas le même coût de combat.
- **Bonus :** poste de défense, taille du territoire, statut de traître.

#### Valeurs de terrain à connaître

| Terrain | Mag | Coût de tuile | Lecture |
|---|---|---|---|
| Plaine | 80 | 16,5 | Base de référence |
| Highland | 100 | 20 | Plus coûteux |
| Montagne | 120 | 25 | Encore plus coûteux |

> **Réflexe.** Avant une attaque, ne regardez pas seulement le nombre de troupes. Une défense concentrée, un terrain difficile ou un poste peuvent changer fortement le résultat.

<details>
<summary>Formules détaillées</summary>

**Densité.** Une forte concentration de troupes sur peu de tuiles augmente le terme de densité utilisé dans le calcul des pertes.

```
densité = troupes du défenseur ÷ tuiles du défenseur
R = troupes du défenseur ÷ troupes de l'attaque
```

**Pertes de l'attaquant.** Pour ce calcul, R est limité à l'intervalle de 0,6 à 2. Une grosse attaque fait donc descendre R.

```
pertes = mag × modificateur de trahison × borne(R ; 0,6 ; 2) × (0,463 × bonus attaquant × bonus défenseur + 0,0039 × densité)
```

Un Civil ou une Nation qui attaque un Bot paie 0,7 × mag : c'est le cas du [calculateur](#calculateur) plus bas sur cette page.

**Vitesse d'attaque.** Un tick dure 100 ms. La vitesse dépend du ratio, du terrain, de la taille des territoires, puis du poste et du statut de traître. En résumé : grosse attaque, R faible, coût qui diminue, conquête plus rapide.

```
coût de vitesse = borne(R ; 0,82 ; 7,5) × borne(R ÷ 20 ; 1 ; 50) ÷ 8,55
part du tick pour une tuile = coût de vitesse × coût de tuile × bonus de taille × modificateur de traître ÷ taille du front
```

</details>
