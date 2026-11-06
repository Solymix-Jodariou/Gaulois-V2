---
name: migration-supabase
description: Modifier le schéma Supabase de la Conquête (migration, fonction SQL, table, réglage, formule), toucher à l'identité ou aux rôles, ou vérifier le vrai projet sans rien écrire. À utiliser dès qu'on touche supabase/, src/lib/conquete/, src/components/conquete/ ou tests/db/.
paths:
  - "supabase/**"
  - "src/lib/conquete/**"
  - "src/components/conquete/**"
  - "src/components/AuthMenu.tsx"
  - "tests/db/**"
  - "tests/support/**"
  - "scripts/conquete-job.ts"
  - "scripts/verifier-mise-en-ligne.ts"
  - "docs/CONQUETE.md"
  - "docs/DIRECTION.md"
---

# Migrations et schéma Supabase

## Le vrai projet

- Projet `zxavwcupauheheqxfdez` (Postgres 17), en ligne depuis le 06/11/2026 : schéma installé, Discord activé, inscription par e-mail coupée, fondateur désigné. Les tests tournent sur Postgres 18 (`embedded-postgres`, sans Docker). Mise en ligne pas à pas, tables et droits par rôle : `docs/CONQUETE.md` ; connexion, rôles et `/direction` : `docs/DIRECTION.md`.
- Aucune écriture sans accord explicite : ni `db push`, ni éditeur SQL, ni `--yes` (le CLI l'exige en mode agent : ne l'ajouter qu'avec l'accord pour cette écriture précise). C'est la personne qui pilote qui lance `npx supabase db push` (voir `/publier`).
- La clé `sb_secret_…` contourne toutes les règles : secrets GitHub seulement, jamais le navigateur ni le dépôt.
- Le forfait gratuit suffit ; si une étape demande de payer, s'arrêter. Pause possible après une semaine d'inactivité (la tâche quotidienne devrait l'éviter, sans garantie). Aucune sauvegarde automatique : la tâche exporte chaque jour un fichier chiffré (`BACKUP_PASSPHRASE`), restauration à la main.

## Vérifier le vrai projet sans rien écrire

```
npx --no-install supabase db query --remote=zxavwcupauheheqxfdez --read-only -f fichier.sql
npx --no-install supabase config diff --remote=zxavwcupauheheqxfdez
npx --no-install supabase db push --remote=zxavwcupauheheqxfdez --dry-run
```

Sans `--remote`, le CLI vise une base locale. `--dry-run` liste les migrations manquantes sans rien écrire.

## Avant d'écrire

- Les migrations sont figées : `db push` ne rejoue jamais une migration appliquée. Toute correction est un nouveau fichier daté après le dernier installé (`20261106000200_dons_copies_a_la_main.sql` au 06/11/2026), jamais une modification en place.
- Personne n'écrit directement dans une table : tout passe par une fonction qui vérifie l'appelant, sous le verrou de la saison pour le jeu. Les fonctions publiques ne montrent jamais l'identifiant technique d'un compte. Ce que l'API ne doit pas voir va dans le schéma `internal`.

## Nouvelle fonction SQL

Postgres ouvre toute fonction nouvelle à tout le monde, visiteurs compris, et `20261105009000_droits.sql` ne ferme que celles créées avant lui. La migration qui crée la fonction fait donc elle-même :

1. `revoke all on function … from public, anon, authenticated;`
2. puis ses `grant` ciblés.

`tests/db/comptes.test.ts` échoue si un visiteur peut appeler la fonction : lancer `npm run test:db`.

## Nouvelle table dans `public`

Supabase ouvre toute nouvelle table à `anon` et `authenticated` (`pg_default_acl`). La migration qui la crée :

1. active RLS ;
2. fait `revoke all on table … from anon, authenticated;`.

## Toute écriture SQL

Garder un `WHERE` sur chaque `update` et `delete` : Supabase refuse sinon.

## Formules et réglages

- Une formule reste identique dans `src/lib/conquete/rules.ts` et en SQL ; `tests/db/formules.test.ts` compare les deux.
- Un réglage ajouté va aussi dans `config/conquete.json`, `internal.config_problem` et `src/lib/conquete/config-labels.ts`.

## Identité, comptes et rôles

- Ne jamais lire `raw_user_meta_data` : il s'écrit depuis le navigateur (`auth.updateUser`) et permettrait d'usurper le nom Discord et le rôle de fondateur. L'identité vient de `auth.identities`, relue à chaque connexion par `on_auth_user_updated` ; le nom gardé est le nom d'utilisateur Discord, pas le nom affiché. `tests/db/direction.test.ts` garde ces règles.
- Un compte sans Discord ne peut rien demander. Une suspension ne se lève que par un admin de rang supérieur (contrainte posée sur la table). Personne ne valide ses propres dons ni ne change son propre rôle. Le rang dans le jeu ne donne aucun droit : la liste des membres est publique, un officier confirme.
- Le premier fondateur fait sa demande dans `/compte` avant `bootstrap_founder`, puis la valide lui-même dans `/admin`. Un compte déjà validé ne peut plus en faire : il resterait « Gaulois n° … », sans lien OpenFront (`tests/db/direction.test.ts`).
- L'encadrement se prévoit par SQL (`internal.role_presets`, rempli par la direction, voir `docs/DIRECTION.md`) ; seuls `admin` et `officer`, une ligne s'efface dès qu'elle a servi. Quelqu'un validé avant l'installation reçoit son rôle à la main dans `/admin`. Ces identifiants Discord n'entrent jamais dans ce dépôt public.
- Qui est connecté, avec quel rôle : joindre `private_links` et `profiles` sur `discord_id`, en lecture seule, sans publier de nom.

## Connu, non corrigé (audit du 06/11/2026)

- Des fonctions du schéma `internal` sans `search_path`, et des séquences ouvertes à `anon` et `authenticated` : sans effet aujourd'hui.
- Probable, non testé : un membre dont l'e-mail Discord est absent ou non vérifié serait refusé à la connexion.

## Mise en ligne

Voir `/publier` : ordre schéma → site → variables GitHub. Sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY`, le jeu reste fermé et le site entièrement statique.
