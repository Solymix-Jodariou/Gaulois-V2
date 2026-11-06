---
name: publier
description: Met le site GAL en ligne sans demander d'accord, de bout en bout — vérifications complètes, relecture, synchronisation avec origin/main (le robot y pousse des données chaque heure), commit par fichiers nommés, push sur main, suivi de la GitHub Action et contrôle du site publié. À utiliser dès qu'un changement est prêt, pour toute mise en ligne, et avec /publier.
---

# Publier

Un push sur `main` lance `.github/workflows/site.yml` : `npm test`, build, puis publication sur GitHub Pages. La collecte des données (`update-data`) ne tourne pas sur un push : elle tourne toutes les heures, lancée par la tâche « Collecte GAL » de cron-job.org à la minute 53 et par le planning de GitHub à la minute 23. Elle pousse elle-même dans `data/`, donc `origin/main` avance sans toi.

Tu n'as pas besoin d'accord pour publier. Tu as besoin que tout passe.

## 1. Vérifier

Suivre la skill `verifier` jusqu'au bout. Un contrôle qui échoue arrête la publication.

## 2. Faire relire

Si le changement touche `src/lib/`, `scripts/`, `supabase/`, `tests/` ou plus d'une centaine de lignes : demander au sous-agent `relecteur` de relire le diff (`git diff origin/main...HEAD`, ou `git diff` si rien n'est encore committé). Corriger ce qu'il signale comme bloquant, puis refaire l'étape 1 si du code a changé.

## 3. Se mettre à jour sur origin/main

```bash
git fetch origin
git status
```

- Travailler sur `main`. Si le travail est sur une autre branche ou un worktree, le ramener sur `main` par `git merge` ou `git rebase`, pas par une copie de fichiers.
- `git pull --rebase origin main`. En cas de conflit dans `data/` : garder la version d'`origin`, celle du robot, toujours. `data/meta.json` entier vient d'`origin`.
- Vérifier `data/history/` après le rebase : Git y garde parfois une vieille version sans signaler de conflit. Les fichiers doivent être ceux d'`origin/main` (`git diff origin/main -- data/` vide).
- Si le rebase a touché du code, refaire `npm run build` et `npm test` au minimum.

## 4. Composer le commit

- Ajouter chaque fichier par son nom : `git add src/pages/x.astro tests/e2e/site.spec.ts`. Jamais `git add -A`, `--all` ni `.`.
- Relire `git diff --cached --stat` puis `git diff --cached`. Doivent être absents : `.env`, tout fichier de `supabase/.temp/`, `public/generated/`, `dist/`, `test-results/`, un identifiant Discord, une clé, un fichier de `data/` modifié à la main.
- `git status` ne doit plus montrer de fichier modifié que tu voulais inclure.
- Message en français, une ligne, préfixe par domaine puis résumé à l'indicatif : `pages: ajoute la page Événements`, `design: resserre la grille des membres sur mobile`, `contenu: nouveau chapitre du guide`, `supabase: table des sondages`, `tests: couvre le tri par arrivée`, `docs: …`. Le préfixe `data:` est réservé au robot. Un corps de message explique le pourquoi quand ce n'est pas évident.

## 5. Pousser

```bash
git push origin main
```

Jamais de `--force`. Si le push est refusé parce qu'`origin` a avancé : revenir à l'étape 3.

## 6. Suivre l'Action

```bash
gh run list --workflow site.yml --limit 1
gh run watch <id> --exit-status
```

- Si `gh` manque ou n'est pas connecté : attendre trois minutes, puis lire <https://github.com/Solymix-Jodariou/Gaulois-V2/actions> ; dire dans le rapport que le suivi s'est fait sans `gh`.
- En cas d'échec : `gh run view <id> --log-failed`, corriger, et recommencer depuis l'étape 1. Le site reste sur sa version précédente tant que le build échoue : rien n'est cassé en ligne, mais rien n'est publié non plus.

## 7. Contrôler le site en ligne

Ouvrir <https://solymix-jodariou.github.io/Gaulois-V2/> et la ou les pages changées. Vérifier qu'au moins un élément visible du changement est bien là, que le pied de page affiche « Dernière collecte » et « © OpenFront and Contributors », et que la page ne montre ni erreur ni bloc vide. GitHub Pages peut servir l'ancienne version une ou deux minutes : réessayer avant de conclure.

## Schéma Supabase

Un changement de schéma se met en ligne **avant** le site qui l'utilise, selon la skill `supabase`. Les variables GitHub `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` sont déjà posées : ne pas y toucher.

## Rapport

En français simple : ce qui est en ligne (une phrase par changement), le commit, le lien de l'exécution de l'Action, ce qui reste à faire ou à relire par un membre du clan (textes, parcours dans le jeu). Si quelque chose n'a pas pu être vérifié, le dire.
