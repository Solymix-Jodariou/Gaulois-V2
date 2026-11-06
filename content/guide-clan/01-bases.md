---
title: "Les bases : population, troupes et tuiles"
order: 1
---

Une tuile est simplement une case du territoire sur la carte. La population donne une capacité de troupes, et les troupes servent à attaquer ou à défendre.

- **Population :** plus votre population et votre capacité sont élevées, plus vous pouvez disposer de troupes.
- **Troupes :** votre réserve disponible. Une partie sert à défendre votre territoire.
- **Tuile :** une case de carte. Le nombre de tuiles occupées compte pour la densité.

#### Combien partent avec une attaque ?

| Joueur | Règle simple | À retenir |
|---|---|---|
| Civil | Attaque = troupes ÷ 5 | Une grosse réserve ne signifie pas que toute la réserve part sur la tuile. |
| Bot | Attaque = troupes ÷ 20 | Les bots utilisent une règle d'attaque plus faible. |

Le Civil désigne ici un joueur humain, et le ÷ 5 correspond au réglage par défaut de son curseur d'attaque (20 %). Exemple : 50 000 troupes disponibles sur un Civil donnent une force d'attaque standard de 10 000.

> **Important.** Quand vous envoyez des troupes en attaque, ces unités ne sont plus disponibles pour votre défense.

<details>
<summary>Formules détaillées</summary>

De la population à l'attaque : population (capacité), puis troupes (réserve), puis attaque (troupes ÷ 5). Le reste demeure en défense.

Dans le code, `cityTroopIncrease() = 250 000` : chaque niveau de Ville ajoute 250 000 troupes de capacité.

```
capacité = 2 × (tuiles^0,6 × 1 000 + 50 000) + niveaux de Ville × 250 000
```

</details>
