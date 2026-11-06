---
paths:
  - "supabase/**"
  - "tests/db/**"
  - "tests/support/**"
  - "scripts/conquete-job.ts"
  - "scripts/verifier-mise-en-ligne.ts"
  - "src/lib/conquete/**"
  - "src/components/conquete/**"
  - "src/components/AuthMenu.tsx"
  - "docs/CONQUETE.md"
  - "docs/DIRECTION.md"
---

# Supabase : base, identité, droits, migrations

Vrai projet `zxavwcupauheheqxfdez` (Postgres 17), en ligne depuis le 06/11/2026 : schéma installé, Discord activé, inscription par e-mail coupée, fondateur désigné. Les tests tournent sur Postgres 18 (`embedded-postgres`, sans Docker). Mise en ligne pas à pas, tables et droits par rôle : `docs/CONQUETE.md` ; connexion, rôles et `/direction` : `docs/DIRECTION.md`.

## Le vrai projet

- Aucune écriture sans accord explicite : ni `db push`, ni éditeur SQL, ni `--yes` (le CLI l'exige en mode agent : ne l'ajouter qu'avec l'accord pour cette écriture précise).
- Contrôle en lecture seule, sans secret : `npx --no-install supabase db query --remote=zxavwcupauheheqxfdez --read-only -f fichier.sql` et `npx --no-install supabase config diff --remote=zxavwcupauheheqxfdez`. Sans `--remote`, le CLI vise une base locale. `db push --remote=… --dry-run` liste les migrations manquantes sans rien écrire.
- Sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY`, le jeu reste fermé et le site entièrement statique. Ces variables GitHub ne se posent qu'une fois le schéma installé et le site publié à jour. La clé `sb_secret_…` contourne toutes les règles : secrets GitHub seulement, jamais le navigateur ni le dépôt.
- Le forfait gratuit suffit ; si une étape demande de payer, s'arrêter. Pause possible après une semaine d'inactivité (la tâche quotidienne devrait l'éviter, sans garantie). Aucune sauvegarde automatique : la tâche exporte chaque jour un fichier chiffré (`BACKUP_PASSPHRASE`), restauration à la main.

## Migrations

- Figées : `db push` ne rejoue jamais une migration appliquée. Toute correction est un nouveau fichier daté après le dernier installé (`20261106000200_dons_copies_a_la_main.sql` au 06/11/2026), jamais une modification en place.
- Postgres ouvre toute fonction nouvelle à tout le monde, visiteurs compris, et `20261105009000_droits.sql` ne ferme que celles créées avant lui : la migration qui crée une fonction fait elle-même `revoke all on function … from public, anon, authenticated`, puis ses `grant`. `tests/db/comptes.test.ts` échoue si un visiteur peut l'appeler.
- Supabase ouvre aussi toute nouvelle table de `public` à `anon` et `authenticated` (`pg_default_acl`) : la migration qui la crée active RLS et fait `revoke all … from anon, authenticated`. Ce que l'API ne doit pas voir va dans le schéma `internal`.
- Toute écriture SQL garde un `WHERE` : Supabase la refuse sinon. Personne n'écrit directement dans une table : tout passe par une fonction qui vérifie l'appelant, sous le verrou de la saison pour le jeu. Les fonctions publiques ne montrent jamais l'identifiant technique d'un compte.

## Identité et rôles

- Ne jamais lire `raw_user_meta_data` : il s'écrit depuis le navigateur (`auth.updateUser`) et permettrait d'usurper le nom Discord et le rôle de fondateur. L'identité vient de `auth.identities`, relue à chaque connexion par `on_auth_user_updated` ; le nom gardé est le nom d'utilisateur Discord, pas le nom affiché. `tests/db/direction.test.ts` garde ces règles.
- Un compte sans Discord ne peut rien demander. Une suspension ne se lève que par un admin de rang supérieur (contrainte posée sur la table). Personne ne valide ses propres dons ni ne change son propre rôle. Le rang dans le jeu ne donne aucun droit : la liste des membres est publique, un officier confirme.
- Premier fondateur : demande dans `/compte` avant `bootstrap_founder`, puis validation de sa propre demande dans `/admin`. Un compte déjà validé ne peut plus lier son profil OpenFront : il resterait « Gaulois n° … ».
- Encadrement prévu : `internal.role_presets`, rempli en SQL par la direction (`docs/DIRECTION.md`) ; seuls `admin` et `officer`, une ligne s'efface dès qu'elle a servi. Ces identifiants Discord n'entrent jamais dans ce dépôt public. Quelqu'un validé avant l'installation reçoit son rôle à la main dans `/admin`.
- Qui est connecté, avec quel rôle : joindre `private_links` et `profiles` sur `discord_id`, en lecture seule, sans publier de nom.

## Connu, non corrigé (audit du 06/11/2026)

- Des fonctions du schéma `internal` sans `search_path`, et des séquences ouvertes à `anon` et `authenticated` : sans effet aujourd'hui.
- Probable, non testé : un membre dont l'e-mail Discord est absent ou non vérifié serait refusé à la connexion.
