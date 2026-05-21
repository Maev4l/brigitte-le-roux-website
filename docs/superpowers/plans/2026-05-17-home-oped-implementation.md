# Home Page Op-Ed Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home page (`/` and `/en/`) with the Op-Ed Wrap layout
defined in `docs/frontend-design/home-rework.md` — a portrait floated right
with its top edge aligned to the headline, a vermillion Fraunces drop-cap on
the opening bio paragraph, and a three-tile strip (`Affiliations / Méthodes
/ Nouveau`) at the bottom. No other route changes visually.

**Architecture:** Add a `page_layout: home` discriminator in markdown
frontmatter that the existing catch-all routes (`src/pages/[...slug].astro`
and `src/pages/en/[...slug].astro`) dispatch on. **Note:** the field is
`page_layout`, not `layout` — Astro 5 reserves `layout` in markdown
frontmatter as a layout-component import path; using `page_layout`
avoids that collision. A new `HomeLayout.astro` reads structured frontmatter
fields (kicker, deck_html, portrait, tiles) and accepts the rendered
`<Content />` from the route — the bio prose itself lives in the markdown
body, rendered by Astro's content-collection pipeline like every other
page. HomeLayout emits the hero + tile-strip markup with scoped styles.
`BaseLayout` gains a single `mainClass` prop so the home page can opt into
a wider 1100 px container; every other page keeps the default 820 px column.

**Tech Stack:** Astro 5.18.1, vanilla CSS variables (already in
`src/styles/theme.css`), Yarn, strict version pinning, no TypeScript, no
test framework — verification is `yarn build` + `yarn dev` visual inspection.

---

## File map

| Action  | Path                                          | Responsibility                                                                |
|---------|-----------------------------------------------|-------------------------------------------------------------------------------|
| Modify  | `src/content/config.mjs`                      | Extend the `pages` schema with the optional home-only fields.                 |
| Modify  | `src/layouts/BaseLayout.astro`                | Add `mainClass` prop (default `'container'`) so home can pass `'oped'`.       |
| Modify  | `src/styles/theme.css`                        | Add `.oped` container rule; add `text-wrap: balance` to the global `h1` rule. |
| Create  | `src/layouts/HomeLayout.astro`                | Hero + tile-strip markup, scoped styles, props from a `pages` entry.          |
| Modify  | `src/pages/[...slug].astro`                   | Dispatch on `entry.data.page_layout === 'home'` to `HomeLayout` (FR locale).  |
| Modify  | `src/pages/en/[...slug].astro`                | Same dispatch for the EN locale.                                              |
| Rewrite | `content/pages/home/fr.md`                    | Structured frontmatter + markdown-body bio paragraphs.                        |
| Rewrite | `content/pages/home/en.md`                    | EN counterpart with translated frontmatter and translated bio body.           |

## Conventions used in this plan

- **Bio prose lives in the markdown body, not in frontmatter.** Every other
  page on this site renders its content via Astro's content-collection
  pipeline (`render(entry)` → `<Content />`). The home page follows the
  same pattern: presentational data (kicker, deck, portrait, tiles) stays
  in frontmatter; the bio paragraphs sit below the closing `---` as
  ordinary markdown and are rendered by `<Content />` inside HomeLayout's
  `.bio` wrapper. No markdown-string renderer dep needed.
- **Scoped styles in HomeLayout.** Every home-only rule lives in
  `<style>` inside `src/layouts/HomeLayout.astro` (Astro adds a per-
  component `data-astro-cid-*` attribute, so the rules cannot leak). The
  only home-related rule in `theme.css` is `.oped` (the `<main>` container
  width), because `<main>` is emitted by `BaseLayout` — outside
  HomeLayout's scope.
- **No new colour or font tokens.** Every value resolves to the existing
  `--bg`, `--text`, `--text-muted`, `--border`, `--accent`, `--font-display`,
  `--font-ui` variables in `theme.css`.
- **Each task is independently committable.** Intermediate commits leave
  the site buildable; only Task 5 ("Rewrite home content") flips the home
  page visually.

---

## Tasks

### Task 1: Extend the content collection schema

**Files:**
- Modify: `src/content/config.mjs`

- [ ] **Step 1: Replace the schema block**

Open `src/content/config.mjs`. Replace the existing `schema: z.object({...})`
call (currently lines 13–22) with the version below. The change adds five
optional top-level fields (`page_layout`, `kicker`, `deck_html`, `portrait`,
`tiles`) and keeps every existing field unchanged. All new fields are
`.optional()` so every other page in the collection still validates. Note
that there is **no** `bio_html` field — the bio paragraphs live in the
markdown body and are rendered by Astro's content-collection pipeline, not
read from frontmatter.

```js
  schema: z.object({
    title: z.string(),
    locale: z.enum(['fr', 'en']),
    slug: z.string(),
    description: z.string().optional(),
    keywords: z.string().optional(),
    // optional field to trigger data-driven listing below the markdown body
    listing: z.enum(['books', 'publications']).optional(),
    // Home-only structured fields. Present when `page_layout: home` is set in
    // frontmatter; HomeLayout.astro reads them. They are .optional() at the
    // schema level so the rest of the page collection keeps validating.
    // NOTE: "layout" is a reserved Astro frontmatter key that Vite resolves as
    // a component import path — using "page_layout" avoids that collision.
    page_layout: z.enum(['home']).optional(),
    kicker: z.string().optional(),
    deck_html: z.string().optional(),
    portrait: z.object({
      src: z.string(),
      alt: z.string()
    }).optional(),
    // Note: bio paragraphs are NOT a frontmatter field — they live in the
    // markdown body of home/{fr,en}.md and are rendered by HomeLayout via
    // Astro's <Content /> component, the same pipeline every other page uses.
    tiles: z.object({
      affiliations: z.object({
        title: z.string(),
        body_html: z.string(),
        note: z.string().optional()
      }),
      methodes: z.object({
        title: z.string(),
        items: z.array(z.object({
          label: z.string(),
          ab: z.string()
        }))
      }),
      nouveau: z.object({
        title: z.string(),
        book_title: z.string(),
        book_href: z.string(),
        book_meta: z.string()
      })
    }).optional()
  })
```

- [ ] **Step 2: Verify the schema still accepts every existing page**

Run: `yarn build`
Expected: build succeeds. Look specifically for `result (X pages built in …)`
in the output. No content-collection validation errors.

- [ ] **Step 3: Commit**

```bash
git add src/content/config.mjs
git commit -m "feat(content): extend pages schema with optional home-only fields"
```

---

### Task 2: Add `mainClass` prop to BaseLayout + `.oped` container in theme

**Files:**
- Modify: `src/layouts/BaseLayout.astro:8` (props destructure) and `:76` (`<main>` tag)
- Modify: `src/styles/theme.css` (add `.oped` rule alongside `.container`)

- [ ] **Step 1: Add the `mainClass` prop to BaseLayout**

In `src/layouts/BaseLayout.astro`, change the props destructure from:

```js
const { title, locale = 'fr', description, keywords } = Astro.props;
```

to:

```js
const { title, locale = 'fr', description, keywords, mainClass = 'container' } = Astro.props;
```

Then change the `<main>` element near the bottom of the file from:

```astro
<main class="container">
  <slot />
</main>
```

to:

```astro
<main class={mainClass}>
  <slot />
</main>
```

Every existing caller (PageLayout) omits `mainClass`, so the default
`'container'` keeps the legacy behaviour exactly.

- [ ] **Step 2: Add the `.oped` container rule to `theme.css`**

In `src/styles/theme.css`, find the existing `.container` rule (around
line 30) and add the `.oped` rule directly after it:

```css
.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 50px 28px 96px;
}

/* Wider container for the home page Op-Ed Wrap layout. The home hero needs
   ~1100px to fit the floated portrait beside the headline without cramping. */
.oped {
  max-width: 1100px;
  margin: 0 auto;
  padding: 56px 28px 88px;
}
```

- [ ] **Step 3: Verify nothing visual changed**

Run: `yarn build`
Expected: build succeeds.

Run: `yarn dev` (start it in a separate terminal — leave running for the
rest of the plan). Open `http://localhost:4321/` and `http://localhost:4321/recherches/`.
Expected: pages look exactly as before — the new `.oped` rule is defined
but unused. PageLayout still emits `<main class="container">`.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/BaseLayout.astro src/styles/theme.css
git commit -m "feat(layout): add mainClass prop and .oped wider container"
```

---

### Task 3: Create HomeLayout.astro

**Files:**
- Create: `src/layouts/HomeLayout.astro`

- [ ] **Step 1: Write the full component**

Create `src/layouts/HomeLayout.astro` with the content below. The frontmatter
script pulls `entry` and `locale` from props; the template emits the kicker,
floated portrait, headline, deck, drop-capped bio, and three-tile strip; the
scoped `<style>` block contains every home-only rule.

Two things to be careful about while transcribing:

- The `<figure class="portrait">` MUST appear in source order **after** the
  kicker and **before** the headline. The portrait's top-edge alignment with
  the H1 depends on this — see spec §3 / "Portrait top alignment".
- The bio paragraphs are rendered by `<Content />` (passed from the
  catch-all route). The drop-cap CSS uses `.bio > p:first-of-type::first-letter`
  to target the first markdown paragraph — no class is needed on the `<p>`.

```astro
---
import BaseLayout from './BaseLayout.astro';

// `Content` is the Astro component returned by render(entry) — it renders
// the markdown body of home/{fr,en}.md. Passing it as a prop instead of
// re-deriving here keeps render() in the route (so it runs only once) and
// matches the way other pages slot <Content /> into PageLayout.
const { entry, Content, locale } = Astro.props;
const data = entry.data;
const t = data.tiles;
---

<BaseLayout
  title={data.title}
  locale={locale}
  description={data.description}
  mainClass="oped"
>
  <p class="topkicker"><span class="bar"></span>{data.kicker}</p>

  <figure class="portrait">
    <div class="mat"><img src={data.portrait.src} alt={data.portrait.alt} /></div>
  </figure>

  <h1>the user <span class="it">Le Roux</span></h1>

  <p class="deck" set:html={data.deck_html}></p>

  <div class="bio">
    <Content />
  </div>

  <div class="clear"></div>

  <section class="tiles">
    <div class="tile">
      <h2 class="h">{t.affiliations.title}</h2>
      <p set:html={t.affiliations.body_html}></p>
      {t.affiliations.note && <p class="italic">{t.affiliations.note}</p>}
    </div>
    <div class="tile">
      <h2 class="h">{t.methodes.title}</h2>
      <ul class="methods">
        {t.methodes.items.map(item => (
          <li>{item.label}<span class="ab">{item.ab}</span></li>
        ))}
      </ul>
    </div>
    <div class="tile nouveau">
      <h2 class="h">{t.nouveau.title}</h2>
      <h3><a href={t.nouveau.book_href}>{t.nouveau.book_title}</a></h3>
      <p class="italic">{t.nouveau.book_meta}</p>
    </div>
  </section>
</BaseLayout>

<style>
  .topkicker {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .34em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 18px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .topkicker .bar {
    display: inline-block;
    width: 38px;
    height: 2px;
    background: var(--accent);
  }

  /* Float right BEFORE the H1 in source order — top edge aligns with the
     name's cap-line. Do not change source order; the alignment depends on it. */
  .portrait {
    float: right;
    width: 38%;
    min-width: 280px;
    margin: 0 0 24px 36px;
  }
  .portrait .mat {
    background: #ece4d3;
    padding: 12px;
    border: 1px solid var(--border);
  }
  .portrait img {
    display: block;
    width: 100%;
    height: auto;
    filter: saturate(.9) contrast(1.02);
  }

  /* Override the global h1 (theme.css) for this layout only — scoped rules
     win on specificity because Astro appends [data-astro-cid-*]. */
  h1 {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144;
    font-size: clamp(58px, 8vw, 108px);
    font-weight: 300;
    letter-spacing: -.035em;
    line-height: .9;
    margin: 0 0 28px;
    text-wrap: balance;
  }
  h1 .it {
    font-style: italic;
    font-weight: 300;
    color: var(--text);
  }

  /* text-wrap: balance kills the "CNRS" widow by re-distributing words;
     the deck_html string also carries &nbsp; bonds around each affiliation
     and an explicit <br> between them as belt-and-suspenders. */
  .deck {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 36;
    font-size: 22px;
    line-height: 1.4;
    color: var(--text-muted);
    max-width: 38ch;
    margin: 0 0 36px;
    text-wrap: balance;
  }

  .bio p {
    font-family: var(--font-display);
    font-size: 17px;
    line-height: 1.7;
    margin: 0 0 18px;
    color: var(--text);
  }
  .bio > p:first-of-type::first-letter {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 144;
    font-weight: 400;
    float: left;
    font-size: 88px;
    line-height: .82;
    padding: 6px 12px 0 0;
    color: var(--accent);
    font-style: normal;
  }
  .bio p em { font-style: italic; }
  .bio a {
    color: var(--text);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .bio a:hover { color: var(--accent); }

  .clear { clear: both; }

  .tiles {
    margin-top: 46px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    border-top: 3px solid var(--text);
    border-bottom: 1px solid var(--border);
  }
  .tile {
    padding: 22px 22px 26px;
    border-right: 1px solid var(--border);
  }
  .tile:last-child { border-right: none; }
  /* Vermillion tile titles carry the colour the numerals used to. */
  .tile .h {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .28em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .tile p {
    font-family: var(--font-display);
    font-size: 15px;
    line-height: 1.55;
    margin: 0;
    color: var(--text);
  }
  .tile p.italic {
    font-style: italic;
    color: var(--text-muted);
    font-size: 14px;
    margin-top: 6px;
  }
  .tile a {
    color: var(--text);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .tile a:hover { color: var(--accent); }

  .methods { list-style: none; padding: 0; margin: 0; }
  .methods li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 6px 0;
    font-family: var(--font-display);
    font-size: 15px;
    border-bottom: 1px dotted var(--border);
  }
  .methods li:last-child { border-bottom: none; }
  .methods .ab {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .2em;
    color: var(--accent);
  }

  .nouveau h3 {
    font-family: var(--font-display);
    font-style: italic;
    font-variation-settings: 'opsz' 36;
    font-size: 18px;
    font-weight: 400;
    line-height: 1.25;
    margin: 0 0 6px;
  }
  .nouveau h3 a {
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--border);
    padding-bottom: 2px;
  }
  .nouveau h3 a:hover { border-bottom-color: var(--accent); }

  @media (max-width: 780px) {
    .portrait { float: none; width: auto; margin: 0 0 28px; max-width: 340px; }
    .tiles { grid-template-columns: 1fr; }
    .tile { border-right: none; border-bottom: 1px solid var(--border); }
    .tile:last-child { border-bottom: none; }
    .bio > p:first-of-type::first-letter { font-size: 64px; }
  }
</style>
```

- [ ] **Step 2: Verify the build still passes**

Run: `yarn build`
Expected: build succeeds. `HomeLayout.astro` is now an orphan component (no
route imports it yet), so the site is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/HomeLayout.astro
git commit -m "feat(home): add HomeLayout component for op-ed wrap layout"
```

---

### Task 4: Branch both catch-all routes on `page_layout: 'home'`

**Files:**
- Modify: `src/pages/[...slug].astro`
- Modify: `src/pages/en/[...slug].astro`

- [ ] **Step 1: Update the FR catch-all**

Replace the entire contents of `src/pages/[...slug].astro` with:

```astro
---
import { getEntry, render } from 'astro:content';
import PageLayout from '../layouts/PageLayout.astro';
import HomeLayout from '../layouts/HomeLayout.astro';
import booksData from '../../content/data/books.json';
import publicationsData from '../../content/data/publications.json';

export async function getStaticPaths() {
  const all = import.meta.glob('../../content/pages/**/fr.md', { eager: true });
  return Object.keys(all).map(path => {
    const slug = path
      .replace('../../content/pages/', '')
      .replace('/fr.md', '');
    return { params: { slug: slug === 'home' ? undefined : slug } };
  });
}

const { slug } = Astro.params;
const lookup = (slug ?? 'home') + '/fr';
const entry = await getEntry('pages', lookup);
if (!entry) throw new Error(`Page not found: ${lookup}`);

// Home pages use a dedicated structured layout instead of rendering the
// markdown body — keep the markdown-body render path skipped to avoid
// pointless work and ensure HomeLayout owns the entire visual stack.
// "page_layout" is used instead of "layout" because Astro treats "layout" as a
// reserved frontmatter key that Vite resolves as a layout component import path.
const isHome = entry.data.page_layout === 'home';
const { Content } = await render(entry);
const listing = entry.data.listing;
---

{isHome ? (
  <HomeLayout entry={entry} Content={Content} locale="fr" />
) : (
  <PageLayout title={entry.data.title} locale="fr" description={entry.data.description} keywords={entry.data.keywords}>
    <Content />
    {listing === 'books' && (
      <ul class="book-list">
        {booksData.map(b => (
          <li>
            {b.page_slug
              ? <a href={`${import.meta.env.BASE_URL}${b.page_slug}`}><strong>{b.title_fr}</strong></a>
              : <strong>{b.title_fr}</strong>}
            — {b.authors.join(', ')}, <em>{b.publisher}</em>, {b.year}
            {b.external && <> · <a href={b.external}>éditeur</a></>}
          </li>
        ))}
      </ul>
    )}
    {listing === 'publications' && (
      <ul class="publication-list">
        {publicationsData.map(p => (
          <li>
            <span class="pub-year">{p.year ?? '—'}</span>
            <span class="pub-authors">{p.authors.join(', ')}</span>
            <span class="pub-title">{p.title_fr}</span>
            {p.venue && <span class="pub-venue"><em>{p.venue}</em></span>}
            {p.pdf && <> · <a href={p.pdf}>PDF</a></>}
            {p.external && <> · <a href={p.external}>lien</a></>}
          </li>
        ))}
      </ul>
    )}
  </PageLayout>
)}
```

- [ ] **Step 2: Update the EN catch-all**

Replace the entire contents of `src/pages/en/[...slug].astro` with:

```astro
---
import { getEntry, render } from 'astro:content';
import PageLayout from '../../layouts/PageLayout.astro';
import HomeLayout from '../../layouts/HomeLayout.astro';
import booksData from '../../../content/data/books.json';
import publicationsData from '../../../content/data/publications.json';

export async function getStaticPaths() {
  const all = import.meta.glob('../../../content/pages/**/en.md', { eager: true });
  return Object.keys(all).map(path => {
    const slug = path
      .replace('../../../content/pages/', '')
      .replace('/en.md', '');
    return { params: { slug: slug === 'home' ? undefined : slug } };
  });
}

const { slug } = Astro.params;
const lookup = (slug ?? 'home') + '/en';
const entry = await getEntry('pages', lookup);
if (!entry) throw new Error(`Page not found: ${lookup}`);

// "page_layout" is used instead of "layout" because Astro treats "layout" as a
// reserved frontmatter key that Vite resolves as a layout component import path.
const isHome = entry.data.page_layout === 'home';
const { Content } = await render(entry);
const listing = entry.data.listing;
---

{isHome ? (
  <HomeLayout entry={entry} Content={Content} locale="en" />
) : (
  <PageLayout title={entry.data.title} locale="en" description={entry.data.description} keywords={entry.data.keywords}>
    <Content />
    {listing === 'books' && (
      <ul class="book-list">
        {booksData.map(b => (
          <li>
            {b.page_slug
              ? <a href={`${import.meta.env.BASE_URL}en/${b.page_slug}`}><strong>{b.title_en}</strong></a>
              : <strong>{b.title_en}</strong>}
            — {b.authors.join(', ')}, <em>{b.publisher}</em>, {b.year}
            {b.external && <> · <a href={b.external}>publisher</a></>}
          </li>
        ))}
      </ul>
    )}
    {listing === 'publications' && (
      <ul class="publication-list">
        {publicationsData.map(p => (
          <li>
            <span class="pub-year">{p.year ?? '—'}</span>
            <span class="pub-authors">{p.authors.join(', ')}</span>
            <span class="pub-title">{p.title_en}</span>
            {p.venue && <span class="pub-venue"><em>{p.venue}</em></span>}
            {p.pdf && <> · <a href={p.pdf}>PDF</a></>}
            {p.external && <> · <a href={p.external}>link</a></>}
          </li>
        ))}
      </ul>
    )}
  </PageLayout>
)}
```

- [ ] **Step 3: Verify nothing visible changed yet**

Run: `yarn build`
Expected: build succeeds.

Visual: Open `http://localhost:4321/` and `http://localhost:4321/en/`. The
home pages still render the OLD content (markdown body via PageLayout), because
no markdown file has `page_page_layout: home` yet. Spot-check `http://localhost:4321/livres/`
and `http://localhost:4321/en/publications/` — they must still render correctly
(the listing branches were preserved verbatim).

- [ ] **Step 4: Commit**

```bash
git add src/pages/[...slug].astro src/pages/en/[...slug].astro
git commit -m "feat(routing): dispatch home pages to HomeLayout"
```

---

### Task 5: Rewrite home content (FR and EN)

**Files:**
- Rewrite: `content/pages/home/fr.md`
- Rewrite: `content/pages/home/en.md`

This task is the one that flips the home page visually. Run `yarn dev` in
parallel; the dev server should hot-reload as you save each file.

- [ ] **Step 1: Rewrite `content/pages/home/fr.md`**

Replace the entire contents of `content/pages/home/fr.md` with:

```markdown
---
title: "the user"
locale: fr
slug: "home"
description: "Page d'accueil de the user, chercheuse spécialiste de l'analyse géométrique des données."
page_layout: home
kicker: "Analyse géométrique des données · Recherche"
deck_html: "Chercheuse en mathématiques. Analyse géométrique des données — MAP5,&nbsp;Université&nbsp;Paris&nbsp;Cité,<br>et CEVIPOF&nbsp;/&nbsp;CNRS."
portrait:
  src: "/img/photoweb.jpg"
  alt: "the user"
tiles:
  affiliations:
    title: "Affiliations"
    body_html: "MAP5 — Université Paris Cité<br>CEVIPOF / CNRS"
    note: "45 rue des Saints-Pères · 75270 Paris · Bureau 731-E"
  methodes:
    title: "Méthodes"
    items:
      - { label: "Analyse des correspondances multiples", ab: "ACM" }
      - { label: "Analyse en composantes principales",    ab: "ACP" }
      - { label: "Données structurées",                   ab: "—" }
      - { label: "Inférence combinatoire",                ab: "—" }
  nouveau:
    title: "Nouveau"
    book_title: "Combinatorial Inference in Geometric Data Analysis"
    book_href: "/livres/cigda"
    book_meta: "B. Le Roux & H. Rouanet — Chapman & Hall / CRC, 2019."
---

Les travaux de the user portent sur l'*analyse géométrique des données* (AGD) et ses applications, une approche à la croisée de la statistique multivariée, de la sociologie quantitative et de la science politique.

Affiliée au laboratoire [MAP5](http://map5.mi.parisdescartes.fr/) à l'Université Paris Cité (45 rue des Saints-Pères, bureau 731-E) et chercheuse associée au [CEVIPOF&nbsp;/&nbsp;CNRS](https://www.sciencespo.fr/cevipof/), elle développe et applique des méthodes de l'AGD à des objets relevant des sciences sociales.

Parmi les méthodes étudiées : l'analyse des correspondances multiples (ACM), l'analyse en composantes principales (ACP), l'analyse des données structurées et l'inférence combinatoire — méthode développée avec Henry Rouanet et exposée dans l'ouvrage *Combinatorial Inference in Geometric Data Analysis*.
```

- [ ] **Step 2: Visually verify the FR home**

Open `http://localhost:4321/`. Verify:

1. Above the headline, a small vermillion 38 px bar followed by the text
   `ANALYSE GÉOMÉTRIQUE DES DONNÉES · RECHERCHE` (uppercase, tracked).
2. The headline reads `the user`, with "Le Roux" set in italic
   Fraunces. Both words on the same line at desktop widths; "Le Roux" may
   wrap to a second line at narrow viewports.
3. The portrait (`photoweb.jpg`) sits to the right of the headline, framed in
   a cream mat with a 1 px border. Its top edge is on the same Y as the top
   of "the user".
4. Below the headline, ~28 px of vertical space, then the italic deck reads
   `Chercheuse en mathématiques. Analyse géométrique des données — MAP5,
   Université Paris Cité,` on one line and `et CEVIPOF / CNRS.` on the next.
   Resize the window — "CNRS" must never be alone on a line.
5. The first bio paragraph starts with a large vermillion drop-cap "L" that
   spans roughly three lines of body text. Subsequent paragraphs have no
   drop-cap.
6. Below the bio, a 3 px black horizontal rule, then three columns:
   `AFFILIATIONS` / `MÉTHODES` / `NOUVEAU`. Titles are vermillion, tracked
   uppercase. Hairline divider between each tile. Méthodes lists ACM, ACP,
   `—`, `—` aligned right.
7. The "Combinatorial Inference…" title in the Nouveau tile is italic
   Fraunces with a hairline underline; hovering flips it to vermillion.
8. Other pages (`/recherches/`, `/livres/`, …) still render with the
   original narrower 820 px column — no regression.

- [ ] **Step 3: Rewrite `content/pages/home/en.md`**

Replace the entire contents of `content/pages/home/en.md` with:

```markdown
---
title: "the user"
locale: en
slug: "home"
description: "Homepage of the user, researcher specialising in Geometric Data Analysis."
page_layout: home
kicker: "Geometric Data Analysis · Research"
deck_html: "Mathematician. Geometric Data Analysis — MAP5,&nbsp;Université&nbsp;Paris&nbsp;Cité,<br>and CEVIPOF&nbsp;/&nbsp;CNRS."
portrait:
  src: "/img/photoweb.jpg"
  alt: "the user"
tiles:
  affiliations:
    title: "Affiliations"
    body_html: "MAP5 — Université Paris Cité<br>CEVIPOF / CNRS"
    note: "45 rue des Saints-Pères · 75270 Paris · Office 731-E"
  methodes:
    title: "Methods"
    items:
      - { label: "Multiple Correspondence Analysis",  ab: "MCA" }
      - { label: "Principal Component Analysis",      ab: "PCA" }
      - { label: "Structured Data Analysis",          ab: "—" }
      - { label: "Combinatorial Inference",           ab: "—" }
  nouveau:
    title: "New"
    book_title: "Combinatorial Inference in Geometric Data Analysis"
    book_href: "/en/livres/cigda"
    book_meta: "B. Le Roux & H. Rouanet — Chapman & Hall / CRC, 2019."
---

The user's work focuses on *Geometric Data Analysis* (GDA) and its applications, an approach at the crossroads of multivariate statistics, quantitative sociology and political science.

Member of [MAP5](http://map5.mi.parisdescartes.fr/) at Université Paris Cité (45 rue des Saints-Pères, office 731-E) and associate researcher at [CEVIPOF&nbsp;/&nbsp;CNRS](https://www.sciencespo.fr/cevipof/), she develops and applies GDA methods to objects in the social sciences.

The methods studied include Multiple Correspondence Analysis (MCA), Principal Component Analysis (PCA), Structured Data Analysis and Combinatorial Inference — developed with Henry Rouanet and set out in the book *Combinatorial Inference in Geometric Data Analysis*.
```

- [ ] **Step 4: Visually verify the EN home**

Open `http://localhost:4321/en/`. Verify:

1. Kicker reads `GEOMETRIC DATA ANALYSIS · RESEARCH`.
2. Headline still `the user` (same in both locales).
3. Deck reads `Mathematician. Geometric Data Analysis — MAP5, Université
   Paris Cité, and CEVIPOF / CNRS.` with the same widow-control behaviour.
4. Tile titles: `AFFILIATIONS` / `METHODS` / `NEW`.
5. Nouveau link points to `/en/livres/cigda` (hover and inspect — verify the
   `href` attribute).
6. Language picker switches to `/` and back; `<link rel="alternate" hreflang>`
   tags are emitted (view-source on each page).

- [ ] **Step 5: Build verification**

Run: `yarn build`
Expected: build succeeds. In the output, confirm both `/index.html` and
`/en/index.html` were generated (the build logs each page).

- [ ] **Step 6: Commit**

```bash
git add content/pages/home/fr.md content/pages/home/en.md
git commit -m "feat(home): rewrite home content in op-ed wrap structured frontmatter"
```

---

### Task 6: Add `text-wrap: balance` to the global `h1`

**Files:**
- Modify: `src/styles/theme.css` (existing `h1` rule, around line 127)

- [ ] **Step 1: Add the property**

In `src/styles/theme.css`, locate the existing `h1` rule:

```css
h1 {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 144;
  font-size: 56px;
  font-weight: 300;
  letter-spacing: -.025em;
  line-height: 0.9;
  margin: 0 0 20px;
}
```

Add a single `text-wrap: balance;` line at the end:

```css
h1 {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 144;
  font-size: 56px;
  font-weight: 300;
  letter-spacing: -.025em;
  line-height: 0.9;
  margin: 0 0 20px;
  text-wrap: balance;
}
```

This benefits every page that renders an H1 through PageLayout. HomeLayout
already sets its own `text-wrap: balance` in its scoped block (Task 3,
Step 1), so the home page is unaffected by the cascade either way.

- [ ] **Step 2: Verify**

Run: `yarn build`
Expected: build succeeds.

Visual: Open `http://localhost:4321/recherches/` and a few other pages.
Resize the window to a narrow width and confirm titles that would have
previously had a one-word last line (e.g., a hanging short word) now
distribute more evenly. The rule is purely visual; no layout shifts of
adjacent content.

- [ ] **Step 3: Commit**

```bash
git add src/styles/theme.css
git commit -m "style(typography): balance h1 line wrapping globally"
```

---

### Task 7: Acceptance check against the spec

**Files:** none (verification only — no commit).

- [ ] **Step 1: Walk through each acceptance criterion from
      `docs/frontend-design/home-rework.md`** and record PASS / FAIL.

For each criterion below, open the page in a browser (start `yarn dev` if
not running), reproduce the condition, and confirm the result. If any
criterion fails, open a follow-up task to fix it before merging.

1. **Portrait–headline top alignment at ≥ 1100 px.** Resize to ≥ 1100 px wide.
   The top edge of the portrait mat sits on the exact same Y as the cap-line
   of "the user". (Use the browser's element inspector — both the `<figure
   class="portrait">` and `<h1>` `getBoundingClientRect().top` should match
   within ±1 px.)

2. **"CNRS" never widowed.** Resize the window through the full range
   (320 px → 1600 px). At no width does "CNRS" appear alone on a line.
   `CEVIPOF / CNRS` always renders as a single unbreakable unit (verify by
   inspecting the rendered text — the `&nbsp;` characters should appear in
   the DOM around the slash). `MAP5, Université Paris Cité` always sits on
   a different visual line from the CEVIPOF / CNRS line (due to the
   explicit `<br>` in `deck_html`).

3. **Mobile collapse at < 780 px.** Resize to < 780 px. The portrait
   un-floats and appears at most 340 px wide. The three tiles stack into
   a single column with a hairline `border-bottom` between rows (no
   `border-right` between columns). The drop-cap shrinks from 88 px to 64 px.

4. **Vermillion budget.** Inspect the rendered home page. Vermillion
   (`#b22222` / `--accent`) appears only in: the kicker bar, the kicker
   text, the drop-cap on the first bio paragraph, the three tile titles
   (`AFFILIATIONS` / `MÉTHODES` / `NOUVEAU`), the method abbreviation chips
   (`ACM`, `ACP`, `—`), the "Nouveau" link hover state, and the active nav
   underline in the site header. No other element is vermillion.

5. **No new dependencies or tokens.** Confirm `package.json` still lists
   only `astro` and `@astrojs/sitemap` (no `marked`, `markdown-it`, etc.).
   Confirm `src/styles/theme.css` `:root` block still defines exactly seven
   custom properties (`--bg`, `--text`, `--text-muted`, `--border`,
   `--accent`, `--max-width`, `--line-height`, plus the two `--font-*`
   declarations — same count as before).

6. **FR/EN structural parity.** Diff `content/pages/home/fr.md` and
   `content/pages/home/en.md`. The only differing fields should be:
   `description`, `kicker`, `deck_html`, the three bio paragraphs in the
   markdown body, every `tiles.*.title` / `.body_html` / `.note` string, the four
   `methodes.items[].label`s, and `tiles.nouveau.book_href`. All structural
   keys, the portrait block, and `book_title` / `book_meta` are identical.

7. **Build clean.** Run `yarn build`. No warnings, no errors. Both
   `dist/index.html` and `dist/en/index.html` exist.

8. **hreflang alternates.** View-source on `http://localhost:4321/` and
   `http://localhost:4321/en/`. Each page emits:
   - `<link rel="alternate" hreflang="fr" href="https://brigitte-le-roux.com/" />`
   - `<link rel="alternate" hreflang="en" href="https://brigitte-le-roux.com/en/" />`
   - `<link rel="alternate" hreflang="x-default" href="https://brigitte-le-roux.com/" />`

9. **No regression on other pages.** Open each of the other routes
   (`/recherches/`, `/these/`, `/livres/`, `/publications/`, `/logiciels/`,
   `/cv/`, `/ateliers/`, `/bureau/`) plus their `/en/...` counterparts where
   present. Each renders in the original 820 px column with the H1 styled
   per `theme.css`. The only intended cross-cutting change is that H1s now
   `text-wrap: balance` — verify titles read naturally with no visual
   regression.

- [ ] **Step 2: Record results in the PR description**

When opening the PR for this branch, include the 9-line PASS list (one line
per acceptance criterion) so the reviewer can verify without re-running the
checks themselves.

---

## Summary

After Task 6, the home page renders the Op-Ed Wrap layout in both locales,
and every other route is structurally unchanged. The diff to merge is:

- 1 new file: `src/layouts/HomeLayout.astro`
- 5 modified files: `src/content/config.mjs`, `src/layouts/BaseLayout.astro`,
  `src/pages/[...slug].astro`, `src/pages/en/[...slug].astro`,
  `src/styles/theme.css`
- 2 rewritten files: `content/pages/home/fr.md`, `content/pages/home/en.md`

No new dependencies. No new colour or font tokens. No `package.json` change.
