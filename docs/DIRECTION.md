# La connexion et l'espace Direction

Comment les membres se connectent avec Discord, ce que chaque rôle peut faire, et comment la direction du clan publie depuis le site. L'installation complète de Supabase et de Discord est dans [CONQUETE.md](CONQUETE.md).

**État au 6 novembre 2026 :** en ligne sur le vrai projet Supabase. La connexion Discord et la désignation du fondateur ont été essayées avec un vrai compte. Le reste n'a été testé qu'en local, sur un vrai Postgres et un vrai navigateur.

## Ce que voit chacun

- **Un visiteur :** un bouton « Se connecter » dans l'en-tête de toutes les pages. Tant qu'il n'a pas de session, son navigateur ne télécharge pas Supabase.
- **Un membre connecté :** son nom dans l'en-tête, qui mène à son compte.
- **Un officier, un admin, le fondateur :** en plus, un lien « Direction ». Sur téléphone, seul ce lien reste, faute de place : le compte s'ouvre depuis l'espace Direction.

Sans `PUBLIC_SUPABASE_URL` et `PUBLIC_SUPABASE_KEY`, aucun de ces éléments n'apparaît et le site reste entièrement statique.

## L'espace Direction : `/direction`

- **Ce qui attend une décision :** demandes à traiter, dons à vérifier, membres validés, encadrement, suspendus. Chaque case mène à `/admin`, qui reste l'écran de décision.
- **Annonces et événements :** publiés sans passer par GitHub, visibles aussitôt sur l'accueil, même sans compte. Ils s'ajoutent à ceux de `content/*.json`, qui restent valables. Si le serveur ne répond pas, l'accueil garde ceux du dépôt.
- **Transmettre le rôle de fondateur :** visible du fondateur seul. Il faut retaper le nom de la personne. L'ancien fondateur devient admin.

Une annonce parle au nom du clan : le nom de son auteur n'est pas public, seuls l'encadrement et le journal le connaissent.

## Les droits

| Action | Visiteur | En attente | Membre | Officier | Admin | Fondateur |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Lire les annonces et les événements | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ouvrir l'espace Direction | | | | ✓ | ✓ | ✓ |
| Publier une annonce ou un événement | | | | ✓ | ✓ | ✓ |
| Modifier ou supprimer les siens | | | | ✓ | ✓ | ✓ |
| Modifier ou supprimer ceux des autres | | | | | ✓ | ✓ |
| Lever une suspension | | | | | ✓ | ✓ |
| Lever la suspension d'un admin | | | | | | ✓ |
| Transmettre le rôle de fondateur | | | | | | ✓ |

Le reste est dans le tableau de [CONQUETE.md](CONQUETE.md). Chaque droit est vérifié par le serveur : masquer un bouton ne protège rien. Toute publication, modification ou suppression va au journal, titre compris.

**Le rang dans le jeu ne donne aucun droit.** Lors d'une demande, l'officier voit « Chef dans le jeu » ou « Officier dans le jeu », d'après la liste publique des membres. Cette liste étant publique, n'importe qui peut prétendre être cette personne : le rôle sur le site reste une décision humaine.

## L'identité Discord : les règles à garder

Trois failles ont été trouvées et corrigées le 6 novembre 2026, avant toute mise en ligne. Des tests dans `tests/db/direction.test.ts` les empêchent de revenir.

1. **Ne jamais lire `raw_user_meta_data`.** Un utilisateur connecté peut y écrire ce qu'il veut avec `auth.updateUser`, ou à l'inscription par e-mail. S'y fier lui permettait d'afficher aux officiers le pseudo Discord d'un autre, et même de se faire désigner fondateur. L'identité vient seulement de `auth.identities`, relue à chaque connexion.
2. **Un compte sans Discord ne peut rien demander.** Les officiers reconnaissent les gens sur Discord.
3. **Une suspension ne se lève que par un admin de rang supérieur.** La règle est posée sur la table : elle vaut pour toute fonction, présente ou future. Valider une demande restée ouverte ne la contourne plus, et réintégrer un compte jamais validé le remet en attente.

## Après avoir créé les comptes : le contrôle

En plus des étapes de [CONQUETE.md](CONQUETE.md), il faut :

- **Ajouter la redirection** `https://solymix-jodariou.github.io/Gaulois-V2/direction` dans **Authentication → URL Configuration → Redirect URLs**.
- **Couper l'inscription par e-mail** dans **Authentication → Providers → Email**. Le site ne s'en sert pas.

Puis lancez le contrôle. Il n'écrit rien et n'affiche aucune clé. Sous PowerShell, renseignez d'abord les valeurs dans le terminal, sans les enregistrer dans un fichier du dépôt :

```powershell
$env:SUPABASE_URL = "https://votre-projet.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
$env:SUPABASE_SECRET_KEY = "sb_secret_..."
```

```bash
npm run verifier:ligne
```

Il vérifie que le projet répond, que Discord est activé, que l'e-mail est coupé, que le schéma est installé, qu'un visiteur ne peut ni se désigner fondateur ni lire les tables privées, et, avec la clé secrète, que le clan a un fondateur et que la liste des membres a été relue.

**Ce contrôle ne remplace pas un essai réel.** Il reste à faire, avec de vrais comptes :

1. Se connecter avec Discord : le vrai nom Discord doit apparaître dans `/compte`.
2. Faire sa demande dans `/compte`, se désigner fondateur, valider sa propre demande dans `/admin` (détail à l'étape 4 de [CONQUETE.md](CONQUETE.md)), puis ouvrir `/direction`.
3. Publier une annonce, puis la voir sur l'accueil dans une fenêtre privée.
4. Connecter un second compte, faire une demande et la valider.

## Ce qui n'a pas été vérifié

- **L'espace Direction et un second compte sur le vrai Supabase.** La connexion Discord, elle, a été essayée le 6 novembre 2026 : `on_auth_user_updated` remplit bien le nom et l'identifiant depuis `auth.identities`. Le nom gardé est le nom d'utilisateur Discord, pas le nom affiché.
- **Un vrai téléphone, Firefox et Safari.**
