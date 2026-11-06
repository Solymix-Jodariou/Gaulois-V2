# La Conquête des Gaulois

Le jeu de territoires des membres de GAL, avec connexion Discord, rôles et dons de capsules. Les règles expliquées aux joueurs sont dans [REGLES_CONQUETE.md](REGLES_CONQUETE.md), aussi publiées sur la page `/conquete/regles`.

**État au 6 novembre 2026 :** le jeu est branché à un vrai projet Supabase : la connexion Discord marche et le fondateur est désigné. Aucune vraie partie n'a encore été jouée. Sans les réglages décrits plus bas, le site reste entièrement statique et le jeu n'apparaît pas.

C'est la seule partie du site qui a un serveur, une base de données et une connexion. Le cahier des charges du jeu lève ces interdictions pour lui seul. Le reste du site ne change pas, et il continue de marcher si le jeu tombe.

## Architecture

```text
Navigateur ──────────► GitHub Pages : le site statique, la carte (map-v1.json, terrain-v1.webp)
    │
    └── supabase-js ──► Supabase : connexion Discord, Postgres, droits d'accès, fichiers
                            ▲
GitHub Action ──────────────┘  une fois par jour : liste des membres, captures, sauvegarde, annonces
    (clé secrète)
```

**Pourquoi Astro + Supabase, et pas Next.js sur Vercel :** le site actuel ne bouge pas, et un seul service s'ajoute. Les verrous et les droits d'accès devraient de toute façon vivre dans Postgres : un serveur Next.js n'aurait été qu'un intermédiaire de plus.

**Le navigateur ne décide jamais.** Il appelle une fonction SQL (`attack`, `review_donation`…). Elle vérifie l'appelant et les règles, calcule le résultat, puis répond. Aucune table n'est modifiable directement. Les calculs de `src/lib/conquete/rules.ts` ne servent qu'à prévoir le résultat à l'écran, et un test vérifie qu'ils s'accordent avec le serveur.

**Les attaques simultanées :** chaque action prend d'abord un verrou sur la saison. Deux attaques s'exécutent donc l'une après l'autre. Des contraintes en base rendent les troupes négatives impossibles, et l'identifiant de chaque demande empêche un double envoi d'agir deux fois. Retirer ce verrou fait bien échouer les tests : cela a été essayé.

**Pas de tâche planifiée pour jouer :** la réserve se calcule à la demande, d'après le temps écoulé. La guerre commence à la première action après sa date.

**Le direct :** chaque page ouverte demande toutes les 15 secondes le « pouls » de la partie (`get_game_pulse`) : 120 octets de données, mesurés sur la démo. Elle ne relit la carte que si ce pouls a changé, ou toutes les 5 minutes pour la réserve qui monte seule. Un onglet caché ne demande rien. Une relecture complète pèse environ 13 Ko : toutes les 15 secondes, 30 joueurs présents 2 heures par jour dépasseraient à eux seuls les 5 Go mensuels du forfait gratuit.

| Dossier | Contenu |
|---|---|
| `supabase/migrations/` | Le schéma, les règles et les droits. `…_droits.sql` liste qui peut appeler quoi. |
| `config/conquete.json` | Les réglages par défaut |
| `src/lib/conquete/` | Formules pour l'écran, appels au serveur, messages d'erreur, tâche quotidienne |
| `src/components/conquete/` | Les écrans |
| `scripts/generate-conquete-map.ts` | La génération de la carte : hexagones, voisins, noms, contours aux côtes |
| `scripts/generate-conquete-terrain.ts` | La génération de l'image du relief |
| `scripts/conquete-job.ts` | La tâche quotidienne |
| `tests/db/` | Les règles, les droits et les attaques simultanées, sur un vrai Postgres |
| `tests/e2e/conquete.spec.ts` | Le parcours complet dans un navigateur |

## Mettre le jeu en ligne

Rien de ceci ne peut être fait à votre place : il faut créer des comptes. **Le forfait gratuit suffit. Si une étape demande de payer, arrêtez-vous.**

### 1. Créer le projet Supabase

Sur [supabase.com](https://supabase.com), créez un projet gratuit, **dans une région d'Europe** : la page de confidentialité du site l'annonce. La page des tarifs ne dit pas si une carte bancaire est demandée : **je n'ai pas pu le vérifier.**

Notez, dans **Project Settings → API Keys** : l'adresse du projet, la clé **publishable** (`sb_publishable_…`) et la clé **secret** (`sb_secret_…`). La première peut aller dans le navigateur. La seconde contourne toutes les règles d'accès : elle ne va que dans les secrets de GitHub.

### 2. Créer l'application Discord

Sur le [portail développeur de Discord](https://discord.com/developers/applications) : **New Application**, puis **OAuth2**.

- Dans **Redirects**, ajoutez `https://<votre-projet>.supabase.co/auth/v1/callback`, puis cliquez sur **Save Changes**. Sinon, Discord répond « redirect_uri OAuth2 non valide » à la connexion.
- Copiez le **Client ID** et le **Client Secret**.

Dans Supabase, **Authentication → Providers → Discord** : activez-le et collez ces deux valeurs. Le secret reste là, jamais dans le dépôt.

Toujours dans Supabase, **Authentication → URL Configuration** :

- **Site URL :** `https://solymix-jodariou.github.io/Gaulois-V2/`
- **Redirect URLs :** ajoutez `https://solymix-jodariou.github.io/Gaulois-V2/compte`, `https://solymix-jodariou.github.io/Gaulois-V2/admin` et `https://solymix-jodariou.github.io/Gaulois-V2/direction`

Dans **Authentication → Providers → Email**, coupez l'inscription par e-mail : le site ne s'en sert pas. Une fois tout installé, `npm run verifier:ligne` contrôle ces réglages : voir [DIRECTION.md](DIRECTION.md).

### 3. Installer le schéma

Depuis le dossier du projet :

```bash
npx supabase login
```

```bash
npx supabase link
```

```bash
npx supabase db push
```

Sinon, collez chaque fichier de `supabase/migrations/` dans l'éditeur SQL de Supabase, **dans l'ordre de leurs noms**.

### 4. Vous désigner fondateur

Connectez-vous une fois sur le site avec Discord, une fois l'étape 5 faite.

**Faites d'abord votre demande :** dans `/compte`, remplissez « Lier mon profil OpenFront ». Un compte déjà validé ne peut plus en faire : il resterait « Gaulois n° … », sans lien avec son joueur OpenFront.

Puis, dans l'éditeur SQL de Supabase, avec **votre identifiant Discord** (mode développeur de Discord, clic droit sur votre nom, « Copier l'identifiant ») :

```sql
select public.bootstrap_founder('VOTRE_IDENTIFIANT_DISCORD');
```

Cette fonction ne marche qu'une fois, et personne ne peut l'appeler depuis le site.

Enfin, dans `/admin`, onglet **Demandes**, validez votre propre demande : votre pseudo OpenFront devient votre nom de jeu.

### 5. Brancher le site

Sur GitHub, **Settings → Secrets and variables → Actions**.

| Onglet | Nom | Valeur |
|---|---|---|
| Variables | `SUPABASE_URL` | L'adresse du projet |
| Variables | `SUPABASE_PUBLISHABLE_KEY` | La clé `sb_publishable_…` |
| Secrets | `SUPABASE_SECRET_KEY` | La clé `sb_secret_…` |
| Secrets | `BACKUP_PASSPHRASE` | Une longue phrase de votre choix. **Gardez-la :** sans elle, les sauvegardes sont illisibles. |
| Secrets | `DISCORD_WEBHOOK_URL` | Facultatif : annonce les événements marquants sur le Discord |

Relancez ensuite **Données et site** dans l'onglet **Actions**. Le lien « Conquête » apparaît dans le menu.

### 6. Vérifier

1. Sans être connecté, `/conquete` dit « Aucune saison en cours ».
2. Vous vous connectez, puis vous vous désignez fondateur (étape 4).
3. L'onglet **Actions** montre l'étape « Tâche de la Conquête » réussie, et **Demandes** dans `/admin` indique la date de relecture de la liste.
4. Un second compte fait une demande, et vous la validez.
5. Vous créez une saison de test, vous la lancez et vous y jouez.

### 7. Lancer la vraie saison

Dans `/admin`, **Saisons**. Avant la première saison :

- **Saisissez les totaux de départ** des donneurs, relevés dans « Top donateurs » : onglet **Dons**, « Saisir un don ou un total de départ ». Un total de départ ne donne pas de troupes : il ne compte que pour la capacité.
- **Relisez `capsuleFactor` et `troopsPerCapsule`** : voir « Les dons arrivent en troupes ».

## Vérifier les membres : la limite à connaître

La liste des membres est publique : **taper le pseudo ou l'identifiant d'un membre ne prouve pas qu'on est ce membre.** Un contrôle automatique seul laisserait n'importe qui récupérer les capsules d'un autre. Le site compare donc la demande à la liste, puis **un officier confirme**, en reconnaissant la personne sur Discord. Seul l'encadrement noté à l'avance par la direction s'en passe : son identifiant Discord ne s'imite pas, voir « Les rôles prévus » dans [DIRECTION.md](DIRECTION.md).

La preuve automatique existe : le jeton d'identité d'OpenFront (voir [API_AUDIT.md](API_AUDIT.md), section 9). Elle n'est pas branchée : OpenFront doit d'abord ajouter le site à sa liste. Le message est prêt en fin de page. Une fois le site accepté, il restera à écrire une petite fonction serveur (Edge Function) qui valide le jeton.

## Les formules

Adaptées du code d'OpenFront, commit `5b75bd3`, réécrites et non copiées : ce code est sous AGPL-3.0. Sources : `packages/engine-lib/src/configuration/Config.ts` et `packages/engine/src/configuration/EngineConfig.ts`.

| | OpenFront | La Conquête |
|---|---|---|
| Capacité | `2 × (tuiles^0,6 × 1000 + 50 000) + villes` | Identique, avec 1 territoire = 100 tuiles. Les capsules remplacent les villes : `+ 2000 × √capsules` |
| Régénération | `(10 + troupes^0,73 ÷ 4) × (1 − troupes ÷ max)`, toutes les 100 ms | Identique, toutes les heures |
| Départ | 25 000 | 25 % de la capacité sans territoire |
| Terre libre | `mag ÷ 5` par tuile | 1 600, 2 000 ou 2 400 troupes |
| Force du terrain (`mag`) | 80, 100, 120 | Identique |
| Pertes d'attaque | `mag × rapport × (0,463 × bonus + 0,0039 × densité)` par tuile | Le même calcul, additionné sur 100 tuiles, sans les bonus de grand territoire, négligeables à cette échelle |
| Rapport | `défenseur ÷ attaque`, borné entre 0,6 et 2 | Identique, calculé une fois au début du combat |
| Défense | Poste de défense : ×5 sur `mag` | Toute garnison est retranchée : ×5 sur la densité seulement |

**Le combat :**

```text
rapport = garnison ÷ envoyés, borné entre 0,6 et 2
pertes  = mag × rapport × (46,3 + 0,0195 × garnison)
```

- **Si les pertes sont inférieures aux troupes envoyées :** le territoire est pris, et les survivants deviennent la garnison.
- **Sinon :** tous les envoyés meurent, et la garnison perd la part du territoire que l'attaque aurait prise : `garnison × envoyés ÷ pertes`. Elle ne tombe jamais sous 1.

**Pourquoi le ×5 :** sans lui, 62 à 83 % de la garnison suffisent pour gagner, et renforcer ne servirait à rien. Il ne porte que sur la densité : sur tout le calcul, reprendre une terre presque vide coûterait 12 000 troupes.

**Le coefficient 2000 tient face aux vrais dons.** Il a été vérifié le 6 novembre 2026 sur les montants de l'onglet Dons du clan, réservés aux membres : ils ne sont pas recopiés ici. Pour un total de 80 000 capsules, la capacité est d'environ 750 000 pour 5 terres, 4,1 fois celle d'un joueur sans capsule. Il reste à éprouver dans une vraie partie.

## Les dons arrivent en troupes

**La règle.** Pendant une saison, chaque capsule donnée arrive en renfort dans la réserve du donneur : 100 troupes par capsule (`troopsPerCapsule`), la règle réelle de la carte du clan. La capacité reste le plafond, comme le demande le cahier des charges : un gros donneur reste avantagé sans écraser les autres. Un don de 250 capsules apporte 25 000 troupes, un don de 10 000 capsules remplit la réserve.

| Cas | Ce qui se passe |
|---|---|
| Don fait pendant la saison, joueur déjà sur la carte | Les troupes arrivent à l'instant où le don est validé |
| Joueur pas encore entré dans la saison | Ses dons de la saison s'ajoutent à ses troupes de départ |
| Don d'avant le lancement, ou total de départ | Il ne compte que pour la capacité |
| Réserve pleine | Rien de plus, et le fil le dit. Le don compte toujours pour la capacité et les classements. |
| Don annulé par un officier | Ses troupes repartent, sans que la réserve passe sous zéro |
| Donneur anonyme | Il le reste dans le fil et sur Discord |

**Le chemin d'un don.** Tout passe par `internal.grant_donation_troops`, sous le verrou de la saison : un don ne peut pas croiser une attaque.

### Ce qui empêche un vrai temps réel, et pourquoi il n'y a pas de contournement

Le jeu montre les dons à un membre connecté. Le site, lui, ne peut pas les lire. Vérifié le 6 novembre 2026 :

1. `GET /clans/GAL/donations` répond 401 sans compte. Aucune route de dons n'est publique.
2. Cette route n'accepte les appels de navigateur que depuis `https://openfront.io` : notre site ne peut pas l'appeler, même avec un compte.
3. **Les conditions d'utilisation d'OpenFront ferment les deux raccourcis.** La section 5 interdit d'accéder au service par un moyen automatisé qu'il ne fournit pas : c'est le cas d'un robot connecté avec le compte d'un membre. La section 6.5 interdit tout script ou extension qui lit le client du jeu, « quel que soit son but », sauf accord écrit d'OpenFront : c'est le cas d'un script dans le navigateur d'un officier.

**Le risque serait pour le compte utilisé, et peut-être pour le clan.** Le site ne fait donc ni l'un ni l'autre. La bonne voie est l'accord d'OpenFront : le message est prêt en fin de page.

**Aujourd'hui,** le délai est donc celui de l'officier : le membre déclare, l'officier vérifie dans l'onglet Dons du jeu et valide, et les troupes arrivent à cet instant. Tous les joueurs le voient dans les 15 secondes.

### Le jour où OpenFront donne un accès

Toute la chaîne est prête et testée, avec des dons fictifs :

1. Placez la clé donnée par OpenFront dans le secret GitHub `OPENFRONT_DONATIONS_KEY`, **et rien d'autre : jamais la session d'un joueur.** Si l'accès prend une autre forme, seule `fetchDonations` dans `src/lib/conquete/job.ts` est à adapter.
2. La tâche planifiée lit l'histoire des dons, puis seulement les nouveaux. Du donneur, elle ne garde qu'une empreinte : ni identifiant, ni pseudo. Le Plutonium est ignoré.
3. **La première lecture remplace les déclarations,** qu'elle contient déjà : les dons validés à la main passent à « remplacé », les totaux sont recalculés, et ces dons d'avant ne redonnent pas de troupes. Les déclarations et la saisie se ferment ensuite. **Revenir en arrière demande une intervention à la main dans la base.**
4. Un don dont l'auteur n'a pas de compte validé attend dans le grand livre, et lui revient à sa validation.
5. **Mettez à jour la page de confidentialité :** elle décrit aujourd'hui des dons déclarés.

**Limite restante :** la tâche planifiée de GitHub tourne environ une fois par heure, avec du retard. Pour lire chaque minute, il faudra une fonction planifiée chez Supabase (`pg_cron` et Edge Function). Elle n'est pas écrite : elle dépend de la réponse d'OpenFront et de son accord sur la fréquence, et elle ne peut pas être essayée sans le vrai Supabase.

## L'ADN d'OpenFront

La Conquête reprend ce qui fait jouer à OpenFront, et change ce qu'il faut pour une saison de plusieurs jours entre membres d'un clan.

| Dans OpenFront | Dans la Conquête |
|---|---|
| La carte remplit l'écran, les commandes se posent dessus | Pareil, avec notre propre habillage |
| Le ratio d'attaque, un clic pour attaquer | Une réglette en %, un clic montre le résultat exact, un second clic envoie |
| Les noms et les troupes sur les territoires | Pareil |
| L'or, les villes, les ports et leur commerce, les postes de défense, les silos, les défenses antiaériennes | Pareil, un bâtiment par terre. Le prix double à chaque bâtiment du même type |
| Les bombes | Détruisent le bâtiment et 75 % de la garnison, sans prendre la terre. Une défense antiaérienne les arrête à coup sûr |
| Les alliances, visibles de tous, avec une durée | 48 heures au lieu de 5 minutes |
| La trahison : défense du traître divisée par 2 | Pareil, pendant 24 heures au lieu de 30 secondes |
| Gagner à 80 % de la carte | Pareil : la saison se termine aussitôt |

**Ce qui diffère volontairement :**

- **Pas de temps réel.** Une partie d'OpenFront dure quelques minutes, et une saison plusieurs jours : les joueurs n'ont pas à être connectés ensemble. Un combat se résout donc d'un coup, et une terre change de main entière.
- **Des hexagones, pas des pixels.** Le serveur (Postgres) ne pourrait pas suivre des millions de tuiles.
- **Aucun hasard, aucun bot, aucun navire.** Les bots demanderaient un serveur qui tourne en continu. Les transports par mer sont remplacés par les voisinages de mer et les routes de haute mer.
- **Pas de chat ni d'émotes :** le clan a déjà son Discord.
- **Des limites par jour** (conquêtes, attaques), pour que personne ne perde tout pendant son sommeil. Elles se règlent dans `/admin`.

**Rien n'est copié.** Le code d'OpenFront est sous AGPL-3.0 et ses images sous CC BY-SA 4.0 : tout est réécrit ici, sans ses images, ses couleurs ni sa mise en page exacte. Les mécaniques et les règles d'un jeu ne sont pas protégées en elles-mêmes, mais ce point n'a pas été relu par un juriste.

## Le guide de première partie

Il accompagne la vraie partie du joueur, sans la simuler : `src/lib/conquete/guide.ts` déduit l'étape en cours de l'état réel du jeu, et `src/components/conquete/GameGuide.tsx` l'affiche. Recharger, changer d'appareil ou revenir trois jours plus tard ne fait donc rien perdre d'important. Seules les explications déjà lues sont retenues, dans le navigateur.

| Étape | Elle se termine quand… |
|---|---|
| Bienvenue | Le joueur a lu, ou possède déjà une terre |
| Choisir sa terre | Une terre libre est sélectionnée. Le guide en conseille 3 sur la carte, et peut en proposer une. |
| S'installer | Il a confirmé |
| Ses ressources | Il a lu |
| Conquérir | Il a 2 terres, ou plus rien à conquérir aujourd'hui |
| Le ratio | Il a lu |
| Renforcer | Il l'a fait, ou l'a remis à plus tard |
| Construire | Il a un bâtiment, ou l'a remis à plus tard. Le guide dit combien d'or il manque, et dans combien de temps. |
| La suite (expansion) | Il a lu. Le guide reviendra à la guerre. |
| Attaquer (guerre) | Il a attaqué, ou l'a remis à plus tard |
| Les alliances (guerre) | Il a lu |
| Vous êtes prêt | Il a lu |

**Ses choix :** les textes prennent leurs chiffres dans les réglages de la saison, aucun n'est écrit en dur. Ses conseils ne regardent que ce qui est public, et ne décident jamais à la place du joueur. Il s'efface devant quelqu'un qui tient déjà 3 terres, et le bouton « Guide » le rouvre.

## Ce que le jeu signale aux joueurs

| Où | Quoi | Délai |
|---|---|---|
| Alertes sur la carte (`src/lib/conquete/notices.ts`) | Ce qui touche le joueur : terre prise ou bombardée, attaque repoussée, alliance proposée, conclue ou rompue, don annulé. Pour tous : la guerre, la victoire, les dons. | 15 secondes au plus. Au retour d'une absence : ce qui le touche, et le début de la guerre. |
| Fil d'actualité | Tout | 15 secondes au plus |
| Discord (`list_events_to_notify`) | Saison lancée et close, guerre, prises, bombes, trahisons, victoire, dons | À chaque tâche planifiée, environ une fois par heure |

Une alerte n'envoie rien hors du site : pas de courriel, pas de notification de navigateur. Un onglet caché ne demande rien au serveur : le joueur est prévenu quand il y revient.

## Les réglages

`config/conquete.json` donne les valeurs par défaut, copiées dans chaque saison à sa création. Les admins les modifient depuis `/admin` : un fichier seul obligerait à republier le site à chaque changement. Toute modification en cours de saison s'applique aussitôt, et l'ancienne valeur reste au journal. Le serveur refuse une valeur hors limites.

| Réglage | Défaut | Rôle |
|---|---:|---|
| `tilesPerTerritory` | 100 | Tuiles d'OpenFront par territoire |
| `capacity.multiplier`, `tilesExponent`, `tilesFactor`, `base` | 2, 0,6, 1 000, 50 000 | La formule `maxTroops` |
| `capacity.capsuleFactor`, `capsuleExponent` | 2 000, 0,5 | Le poids des capsules : `facteur × capsules^exposant` |
| `regen.base`, `exponent`, `divisor` | 10, 0,73, 4 | La formule `troopIncreaseRate` |
| `regen.tickMinutes` | 60 | Minutes entre deux pas de régénération |
| `startShare` | 0,25 | Troupes de départ : part de la capacité sans territoire |
| `troopsPerCapsule` | 100 | Troupes reçues par capsule donnée pendant la saison |
| `terrain.plains`, `highland`, `mountain` | 80, 100, 120 | Force du terrain |
| `neutralDivisor` | 5 | Prix d'une terre libre par tuile : `mag ÷ ce nombre` |
| `combat.ratioMin`, `ratioMax` | 0,6, 2 | Les bornes du rapport |
| `combat.lossBase`, `lossDensity` | 0,463, 0,0039 | Les constantes de `attackLogic` |
| `combat.garrisonBonus` | 5 | Le bonus de garnison |
| `limits.expansionsPerDay` | 10 | Conquêtes de terre libre par jour |
| `limits.attacksPerDay` | 10 | Attaques par jour |
| `limits.attackCooldownMinutes` | 15 | Attente entre deux attaques |
| `limits.protectionHours` | 12 | Protection d'une terre tout juste prise |
| `limits.lastTerritoryProtected` | oui | Le dernier territoire d'un joueur est inattaquable |
| `limits.actionsPerMinute` | 30 | Actions par minute et par joueur |
| `victoryShare` | 0,8 | Part de la carte pour remporter la saison |
| `gold.start`, `perTerritoryPerHour` | 5 000, 100 | L'or de départ, et par terre et par heure |
| `structures.cityCost`, `portCost`, `postCost`, `samCost`, `siloCost` | 10 000, 8 000, 5 000, 15 000, 30 000 | Le prix de base de chaque bâtiment |
| `structures.maxCostDoublings` | 4 | Le prix double à chaque bâtiment du même type, 4 fois au plus |
| `structures.cityCapacity` | 100 000 | Capacité apportée par une ville |
| `structures.postFactor` | 1,5 | Pertes de l'attaquant face à un poste de défense |
| `structures.portGoldPerHour`, `tradeGoldPerPort` | 300, 50 | L'or d'un port, et par port étranger, sur 10 au plus |
| `structures.bombCost`, `bombDamage`, `bombCooldownHours` | 20 000, 0,75, 24 | Le prix d'une bombe, la part de garnison détruite, l'attente entre deux bombes |
| `alliance.hours`, `requestHours` | 48, 24 | La durée d'une alliance et d'une demande |
| `alliance.traitorHours`, `traitorFactor` | 24, 0,5 | La durée du statut de traître, et les pertes de qui l'attaque |

Ces prix et ces durées sont des estimations : **aucune vraie saison n'a encore été jouée**. Ils se règlent dans `/admin`, même en cours de saison.

## La carte

528 hexagones de 270 000 km², sur une projection à aires égales (Equal Earth), générés depuis Natural Earth, qui est dans le domaine public. Deux hexagones couvrent donc la même surface réelle, où qu'ils soient.

- **Voisins :** les six hexagones autour, plus ceux séparés par une seule case de mer, plus quelques routes de haute mer pour que toute la carte soit reliée.
- **Relief :** déduit des zones de montagne et de plateau de Natural Earth. 56 % de plaines, 30 % de collines, 14 % de montagnes.
- **Noms :** la plus grande ville de chaque hexagone, en français. Les lieux en guerre ou disputés sont remplacés par un nom géographique neutre, dans `scripts/conquete-map-names.ts`. **Cette liste date du 5 novembre 2026 : à relire par le clan avant la mise en ligne.**

- **Contours :** chaque hexagone s'arrête aux côtes de Natural Earth (1:50 m) et aux grands lacs. Ce n'est qu'un dessin : un territoire reste un hexagone pour les règles, et toute sa case reste cliquable.
- **Relief :** l'image `HYP_50M_SR` de Natural Earth (domaine public), reprojetée en Equal Earth pour tomber exactement sous les hexagones, avec notre propre océan. Aucune image d'OpenFront n'est utilisée. Les couleurs de l'image sont celles du vrai climat : ce sont les repères ^ et ^^ qui disent le relief au sens des règles.

Le navigateur charge `terrain-v1-small.webp` (63 Ko) sur un petit écran, et `terrain-v1.webp` (207 Ko) sur un grand ou dès qu'on zoome. Le fichier de la carte pèse 298 Ko, 98 Ko une fois compressé.

Pour régénérer : `npm run conquete:map` pour la carte, `npm run conquete:terrain` pour le relief. Les téléchargements pèsent environ 26 et 50 Mo et restent hors de Git, dans `.cache/natural-earth/`. Tant que la carte n'est pas en ligne, on peut la régénérer librement. Ensuite, créez une nouvelle version (`VERSION` dans le script) pour ne pas toucher aux saisons passées. Changer les contours ne change pas le fichier SQL de la carte, tant que les hexagones restent les mêmes.

## Base de données

| Table | Contenu | Qui lit directement |
|---|---|---|
| `profiles` | Nom de jeu, rôle, statut, anonymat, total de capsules | Soi-même, officiers |
| `private_links` | Identifiant et nom Discord, **empreinte** de l'identifiant OpenFront | Soi-même, officiers |
| `internal.role_presets` | Rôles prévus par la direction : identifiant Discord et rôle, effacés dès qu'ils ont servi. Hors du schéma `public`, donc hors de l'API. | Personne : serveur seul |
| `clan_roster` | Liste officielle, en empreintes | Personne : serveur seul |
| `membership_requests` | Demandes et décisions | Soi-même, officiers |
| `admin_log` | Qui, quoi, quand. Ne se modifie ni ne s'efface. | Admins |
| `donations` | Dons, capture, statut, validateur, troupes données | Soi-même, officiers |
| `openfront_donations` | Grand livre des dons lus chez OpenFront, vide tant qu'il n'y a pas d'accès. Montant, date, empreinte du donneur. | Personne : serveur seul |
| `file_cleanup` | Captures à effacer | Personne : serveur seul |
| `seasons` | Phase, dates, réglages, classement et carte figés | Par fonction |
| `territories` | Noms, relief, voisins | Membres connectés |
| `territory_state` | Propriétaire, garnison, bâtiment, fin de protection. Une terre sans ligne est libre. | Par fonction |
| `players` | Réserve, or, compteurs du jour, prises et pertes, statut de traître | Soi-même, officiers |
| `alliances` | Demandes et alliances en cours | Par fonction |
| `game_events` | Fil d'actualité | Par fonction |
| `action_limits`, `action_requests` | Limite de requêtes, demandes déjà traitées | Personne : serveur seul |
| `app_state` | Dernière relecture de la liste, dernière sauvegarde, lecture des dons | Personne : serveur seul |

Personne n'écrit directement dans aucune table : ni visiteur, ni membre, ni officier. Les fonctions publiques ne montrent jamais l'identifiant technique d'un compte, seulement un numéro de joueur.

### Les droits

| Action | Visiteur | En attente | Membre | Officier | Admin | Fondateur |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Voir la carte et les classements | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Demander sa validation | | ✓ | | | | |
| Jouer, déclarer un don | | | ✓ | ✓ | ✓ | ✓ |
| Valider les membres et les dons, saisir un don | | | | ✓ | ✓ | ✓ |
| Retirer un joueur d'une saison | | | | ✓ | ✓ | ✓ |
| Lire le journal, gérer les saisons et les réglages | | | | | ✓ | ✓ |
| Suspendre un membre, gérer les officiers | | | | | ✓ | ✓ |
| Nommer ou retirer des admins | | | | | | ✓ |

Personne ne valide ses propres dons, ni ne change son propre rôle.

## Les limites du forfait gratuit

Lues sur [la page des tarifs de Supabase](https://supabase.com/pricing) le 5 novembre 2026 : 500 Mo de base, 1 Go de fichiers, 50 000 utilisateurs actifs par mois, 5 Go de bande passante, 2 projets actifs.

- **Mise en pause après une semaine d'inactivité.** La tâche quotidienne devrait l'éviter, mais [Supabase ne le garantit pas](https://supabase.com/docs/guides/platform/free-project-pausing), et elle dépend du cron de GitHub. En cas de pause, le jeu affiche « Jeu indisponible » et le reste du site continue. Le projet se relance depuis le tableau de bord.
- **Aucune sauvegarde automatique.** D'où la sauvegarde ci-dessous.
- **La carte bancaire :** la page ne dit pas si elle est demandée.

## La sauvegarde

La tâche quotidienne exporte chaque jour toutes les données, les chiffre (AES-256-GCM, avec `BACKUP_PASSPHRASE`) et les dépose en artefact de l'Action pour 14 jours. Elles sont chiffrées parce que le dépôt est public. Pour en relire une :

```bash
BACKUP_PASSPHRASE="votre phrase" npm run conquete:job -- --lire sauvegarde-2026-11-05.enc
```

Cela produit un JSON lisible. **La restauration n'est pas automatisée :** il faudrait recharger ce JSON à la main. Les comptes de connexion eux-mêmes sont chez Supabase et ne font pas partie de l'export : après une perte totale, chacun se reconnecte, et l'identifiant Discord permet de retrouver qui est qui.

## Regarder le jeu sur son PC

Sans aucun compte, avec une partie fictive déjà en cours :

```bash
npx tsx tests/support/conquete-stack.ts --demo
```

Ouvrez ensuite `http://127.0.0.1:4322/conquete`. La page de connexion propose un nouveau joueur, un membre, un officier, un fondateur et une recrue de démonstration : ouvrez-en deux dans deux navigateurs pour voir les deux côtés. **Pour essayer le guide de première partie, choisissez « Nouveau joueur de démo ».** Tout est fictif, reste sur votre PC et disparaît à l'arrêt.

Toutes les 20 secondes, un don fictif est déclaré puis validé par l'officier de démonstration : connecté comme membre de démonstration, on voit sa réserve monter sans recharger la page. Avec `--direct` en plus de `--demo`, les dons arrivent directement, comme si OpenFront avait donné un accès.

## Les tests

```bash
npm test
```

Lance tout ce qui ne demande pas de navigateur : les formules, puis les règles, les droits et les attaques simultanées sur un **vrai Postgres**, téléchargé par npm (`embedded-postgres`). Docker n'est pas nécessaire.

```bash
npm run build
```

```bash
npm run test:e2e
```

Le parcours complet tourne sur le même Postgres, avec un petit serveur qui imite Supabase (`tests/support/fake-supabase.ts`) : les fonctions SQL et les droits sont les vrais. Seules la page de Discord et la conservation des fichiers sont simulées.

## Ce qui a été vérifié, et ce qui ne l'a pas été

**Vérifié pour de vrai, en local :** les formules et leur accord entre l'écran et le serveur sur 390 combats ; les droits de chaque rôle ; les attaques simultanées, sur de vraies connexions ; la lecture de la vraie liste des membres d'OpenFront par la tâche quotidienne (763 membres le 5 novembre 2026) ; la sauvegarde et sa relecture ; le parcours complet dans Chromium ; l'accessibilité WCAG AA (axe) et l'absence de débordement à 375 px ; la fluidité de la carte avec son relief, sur un processeur simulé 6 fois plus lent (une image toutes les 16,7 ms en médiane, 33 ms pour les 5 % les plus lentes) ; les dons convertis en troupes, sur un vrai Postgres, attaques simultanées comprises.

**Audit du 6 novembre 2026 :** de vrais parcours de joueurs, à la souris, au clavier et au doigt, en plus des tests. Il a trouvé ce que les tests ne regardaient pas, tout est corrigé et couvert par un test :

- Une carte qui suivait la souris sans bouton après un glisser relâché sur un panneau, et une molette qui piégeait la page sur la carte.
- Une terre choisie dans une liste, dont le panneau restait hors de l'écran. Sur téléphone, toucher une terre semblait ne rien faire : son panneau était 200 px sous l'écran.
- Une alliance proposée qui pouvait mettre 5 minutes à arriver, et un joueur attaqué qui n'était prévenu de rien.
- La victoire, les bombes et les trahisons, rédigées pour Discord mais jamais envoyées.
- Un aperçu qui annonçait « Victoire prévue » sur une terre protégée ou sur le dernier territoire d'un joueur, et un second clic qui lançait une attaque annoncée perdante.
- Un défenseur bombardé qui perdait l'or que son port lui devait. Le classement par territoire limité à 6 joueurs. Une fin de saison qui ne nommait pas le vainqueur en haut de l'écran.

**Pas vérifié :**

- **Le reste du vrai Supabase.** Essayés sur le vrai projet le 6 novembre 2026 : la connexion Discord d'un compte, le nom et l'identifiant Discord, la désignation du fondateur, la validation de sa demande et la tâche planifiée (liste relue, sauvegarde créée). Restent à éprouver un second compte, une saison et le stockage des captures : c'est l'objet de l'étape 6.
- **Une vraie partie entre joueurs.** L'équilibre vient de calculs, pas de parties jouées. Les réglages pourront changer après la première saison.
- **La lecture des vrais dons chez OpenFront.** Sans accès, `fetchDonations` n'a jamais tourné contre leur API : elle suit leur schéma public (`ClanApiSchemas.ts`) et n'est testée que contre une imitation.
- **Un vrai téléphone, Firefox et Safari.** La fluidité est mesurée sur un processeur ralenti, sans vrai téléphone.
- **Les annonces sur un vrai Discord,** testées seulement contre une imitation.
- **Le guide avec de vrais débutants.** Son parcours est testé de bout en bout, mais personne de nouveau au jeu ne l'a encore essayé : ses textes pourront changer après les premiers retours.
- **Le droit.** La page de confidentialité décrit honnêtement ce qui est conservé, mais elle n'a pas été relue par un juriste.

## Message à envoyer à l'équipe d'OpenFront

À envoyer par vos soins, sur le canal que vous utilisez avec elle. Il est écrit en anglais, langue de la documentation du jeu. S'il est déjà parti, le paragraphe sur la carte peut être envoyé seul.

> Hello OpenFront team,
>
> I run the community site of the clan [GAL] Les Gaulois: https://solymix-jodariou.github.io/Gaulois-V2/ (unofficial, not affiliated with OpenFront).
>
> We are adding a small seasonal game for clan members, on our own site. Could you add our site to the identity token list (Account settings → Link to a third-party site), so that members can prove they own their account?
>
> Requested audience: `solymix-jodariou.github.io`
>
> How we would use it: our server validates the token once with `POST /public/identity_token/validate`, checks the public ID against `/public/clan/GAL/members`, then discards the token. We store neither the token nor the public ID, only a hash, and members without a public username stay anonymous.
>
> One more question, and the most important one for us. In this game, a member's capsule donations to the clan turn into troops, ideally right away. Donations (`/clans/:tag/donations`) are only visible to signed-in members, and your terms (sections 5 and 6.5) rule out reading them with a player's session or a script, so we do not do that: today our officers enter each donation by hand.
>
> Would you consider giving a clan a read-only way to read its own donation ledger, for example an API key limited to `/clans/GAL/donations`? We would only keep the amount, the date and a hash of the donor's public ID, and we would poll at whatever rate suits you. If you prefer another way, such as a webhook, we can adapt.
>
> A last question, about the clan map. Our site now builds its timelapse from your documented `/public/clanmap/history`, thank you for it. Three things are not in the public API: the ownership snapshot with each clan's troops (`/clanmap/ownership`), the terrain (`/clanmap/terrain`) and a clan's treasury (`/clans/GAL`). `/clanmap/ownership` answered 403 from GitHub Actions, so we stopped reading it and the terrain, and we will not try to get around that. Our reading of `/clans/GAL` fails from GitHub Actions too, so the site shows "no data" for the treasury; we still try once a day, and we will stop if you prefer. Would you consider public versions of these, or tell us if we may read them once a day? And which license applies to the terrain? We publish a reduced, darkened copy as the timelapse background, credited to OpenFront.
>
> Thanks a lot for the game and for the public API!
