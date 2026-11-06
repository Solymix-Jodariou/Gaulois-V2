---
name: supabase
description: Tout travail sur le serveur de connexion (Supabase) — nouvelle migration, fonction SQL, table, droits, identité Discord, rôles prévus — et sa mise en ligne sur le vrai projet sans demander d'accord, sauf si une migration supprime quelque chose. À utiliser dès qu'on touche supabase/, src/lib/compte/, src/components/compte/ ou les scripts qui parlent à Supabase.
paths:
  - "supabase/**"
  - "src/lib/compte/**"
  - "src/components/compte/**"
  - "scripts/relire-membres.ts"
  - "scripts/verifier-mise-en-ligne.ts"
---

# Supabase : la connexion et l'espace Direction

Le fonctionnement, les rôles et l'installation sont décrits dans `docs/DIRECTION.md`. Le projet en ligne est lié (`supabase/.temp/`, ignoré par Git), référence `zxavwcupauheheqxfdez`, Postgres 17, région Europe, forfait gratuit : **si une commande demande de payer, arrêter.** Les tables de l'ancienne Conquête y restent, inutilisées : ne pas les supprimer sans demande explicite, ne pas construire dessus.

## Ce qui ne se négocie pas

- Le serveur décide de tout : chaque droit se vérifie dans la fonction SQL, jamais en masquant un bouton. Le navigateur n'appelle que des fonctions via `call()` de `src/lib/compte/api.ts`.
- L'identité vient de `auth.identities`, jamais de `raw_user_meta_data`, qu'un utilisateur peut écrire lui-même. Un compte sans Discord ne peut rien demander. Une suspension ne se lève que par un admin de rang supérieur. Personne ne change son propre rôle. Toute publication, modification ou suppression va au journal.
- Les tests de droits sur un vrai Postgres ont été retirés avec le jeu : ces règles ne sont plus vérifiées automatiquement. Avant de toucher au serveur, relire la section « L'identité Discord : les règles à garder » de `docs/DIRECTION.md`, et après, les contrôler à la main (ci-dessous).
- Les identifiants Discord de l'encadrement (`internal.role_presets`) s'écrivent dans l'éditeur SQL de Supabase, jamais dans le dépôt, jamais dans un test.

## Écrire une migration

- Les migrations sont figées : `db push` ne rejoue jamais une migration appliquée. **Ajouter un fichier, ne jamais modifier un fichier existant** (les permissions du projet les protègent). Nom : `supabase/migrations/AAAAMMJJHHMMSS_nom_en_francais.sql`, postérieur au dernier.
- Nouvelle fonction SQL : Postgres l'ouvre à tout le monde, visiteurs compris. La migration qui la crée fait elle-même `revoke all on function … from public, anon, authenticated;` puis ses `grant` ciblés.
- Nouvelle table dans `public` : Supabase l'ouvre à `anon` et `authenticated`. La migration active RLS puis fait `revoke all on table … from anon, authenticated;`. Les tables privées vont dans le schéma `internal`.
- Garder un `WHERE` sur chaque `update` et `delete` : Supabase refuse sinon.
- Une fonction appelée depuis le site renvoie `{ ok: true, … }` ou `{ ok: false, error: "code" }` ; le code a son message en français dans `src/lib/compte/errors.ts`, avec son test dans `tests/unit/compte-errors.test.ts`.

## Mettre en ligne un changement de schéma

Tu le fais toi-même, dans cet ordre, **avant** de publier le site qui s'en sert :

La CLI Supabase est en version 3 : sans `--remote`, une commande vise une pile locale (qui n'existe pas ici), et toute modification du projet en ligne demande une confirmation dont la réponse par défaut est non. Toujours écrire `--remote=zxavwcupauheheqxfdez`, et `--yes` pour les commandes qui modifient.

1. Lire la migration une dernière fois. Si elle contient `drop table`, `drop column`, `truncate`, un `delete` sur une table existante ou tout ce qui retire une donnée : **s'arrêter et demander**, en expliquant ce qui serait perdu. Une migration qui ne fait qu'ajouter se pousse sans accord.
2. `npx supabase migration list --remote=zxavwcupauheheqxfdez` : les migrations locales appliquées doivent correspondre à celles du projet. Un écart inattendu s'explique avant de continuer.
3. `npx supabase db push --remote=zxavwcupauheheqxfdez --dry-run` : seule la nouvelle migration doit apparaître.
4. `npx supabase db push --remote=zxavwcupauheheqxfdez --yes`.
5. Contrôler sans rien écrire, avec les valeurs publiques des variables GitHub (la clé secrète reste dans GitHub ; les contrôles qui la demandent affichent « À VOIR », c'est normal) :

   ```bash
   SUPABASE_URL="$(gh variable get SUPABASE_URL)" SUPABASE_PUBLISHABLE_KEY="$(gh variable get SUPABASE_PUBLISHABLE_KEY)" npm run verifier:ligne
   ```

   Et, pour une règle de droits, une requête en lecture seule : `npx supabase db query --remote=zxavwcupauheheqxfdez --read-only -f fichier.sql` (par exemple `select has_function_privilege('anon', 'public.ma_fonction(text)', 'execute');` doit renvoyer `false`). Le fichier SQL de contrôle ne se committe pas.
6. Puis la skill `publier` pour le site.

Si `npx supabase` demande de se connecter (`supabase login`) ou de relier le projet (`supabase link`), c'est une action hors du dépôt : le dire et attendre.

## Les scripts

- `scripts/relire-membres.ts` (`npm run membres:relire`) : lancé chaque heure par l'Action avec `SUPABASE_URL` et `SUPABASE_SECRET_KEY` des secrets GitHub ; sans eux il ne fait rien. Il remplace le `publicId` par son empreinte avant d'écrire.
- `scripts/verifier-mise-en-ligne.ts` (`npm run verifier:ligne`) : les contrôles de `src/lib/compte/preflight.ts`, testés dans `tests/unit/preflight.test.ts`.
- Le site reste entièrement statique sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY` : un test e2e le vérifie. Toute nouvelle fonctionnalité serveur doit garder ce comportement.
