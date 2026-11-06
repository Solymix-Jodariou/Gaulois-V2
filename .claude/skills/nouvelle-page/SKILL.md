---
name: nouvelle-page
description: Ajoute ou refond une page du site GAL (src/pages/*.astro) avec la mise en page Base.astro, la navigation, les états des données, l'accessibilité et les tests e2e qui listent les pages. À utiliser pour « ajouter une page », « nouvelle section », « nouvel onglet », ou la refonte d'une page existante.
paths:
  - "src/pages/**"
---

# Nouvelle page

## Squelette

Nom de fichier en minuscules, sans accent ni espace : `src/pages/evenements.astro` donne `/evenements`.

```astro
---
import Base from "../layouts/Base.astro";
import PageHeader from "../components/PageHeader.astro";
import DataStatus from "../components/DataStatus.astro";
import Empty from "../components/Empty.astro";
import { loadMeta, loadSessions } from "../lib/data";
import { MAX_AGE_HOURS } from "../lib/freshness";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const meta = loadMeta();
const sessions = loadSessions();
---

<Base title="Parties" description="Une phrase pour les moteurs de recherche et les aperçus de lien.">
  <div class="wrap">
    <PageHeader title="Parties" intro="Une phrase qui dit ce que montre la page.">
      <div class="mt-4">
        <DataStatus state={meta.sessions} maxAgeHours={MAX_AGE_HOURS.sessions} />
      </div>
    </PageHeader>
    {sessions.length === 0 ? <Empty title="Pas de données">La collecte n'a pas encore trouvé de partie.</Empty> : <ul>…</ul>}
  </div>
</Base>
```

- `title` : court, il devient `Titre · [GAL] Les Gaulois`. `description` : une phrase pour les moteurs et les aperçus de lien. Une page personnelle prend `noindex`.
- Les liens internes passent par `${base}` : le site vit sous `/Gaulois-V2/`.
- Les données viennent des fonctions de `src/lib/data.ts`, validées par Zod. `null` ou `[]` veut dire « Pas de données » : afficher `Empty.astro` (prop `title`, texte dans le slot) ou masquer la section, jamais un zéro, jamais un exemple.
- Une donnée collectée s'accompagne de sa date : `DataStatus.astro` prend `state={meta.<jeu>}` et `maxAgeHours` depuis `MAX_AGE_HOURS` de `src/lib/freshness.ts` (4 h pour classement et sessions, 36 h pour membres et carte). C'est lui qui affiche la panne de collecte et la péremption côté visiteur.
- Interactivité : un composant Preact `.tsx` dans `src/components/`, hydraté avec `client:idle` ou `client:visible`. Les valeurs finales sont déjà dans le HTML, le script ne fait que les animer. `src/lib/fx/motion.ts` dit si les animations sont permises.
- Les textes qui parlent au nom du clan viennent du clan (`content/`, `config/clan.ts`). Ne pas en écrire à sa place.

## Navigation

Le tableau `nav` dans `src/layouts/Base.astro` alimente le menu desktop et le menu mobile. N'y ajouter une page que si elle s'adresse à tous les visiteurs, et garder sept entrées au plus : au-delà, le menu passe sous la largeur `lg`/`xl` et déborde. Une page secondaire se relie depuis la page qui la concerne ou depuis le pied de page.

## Tests

- Ajouter le chemin à `PAGES` dans `tests/e2e/site.spec.ts` : la page passe alors les tests d'accessibilité (axe, WCAG AA), de défilement horizontal et de pied de page.
- Ajouter au moins une vérification fonctionnelle avec un `data-testid`, dans le style des tests existants, qui compare ce qui s'affiche aux fichiers de `data/` ou `content/`.
- Une page avec des calculs : la logique va dans `src/lib/` avec son test dans `tests/unit/`.

## Avant de finir

Skill `design-gal` pour l'apparence, puis `verifier`, puis `publier`. Si la page a un contenu que seul un membre du clan peut confirmer, le dire dans le rapport.
