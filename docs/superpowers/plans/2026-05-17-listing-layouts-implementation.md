# Listing Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract /livres and /publications listing rendering from the
catch-all routes into dedicated `BooksLayout.astro` and
`PublicationsLayout.astro` components, matching the existing `HomeLayout`
precedent. Pure refactor — the rendered HTML stays visually identical.

**Architecture:** Routes become thin dispatchers (~50 LOC) that select a
layout based on `entry.data.page_layout` (widened from `'home'` to
`'home' | 'books' | 'publications'`). The redundant `listing` field is
dropped. CSS rules specific to one listing migrate into scoped `<style>`
blocks inside the corresponding layout; rules shared by both (table styles,
`.listing-section`, `.listing-subsection`) stay in `theme.css`.

**Tech Stack:** Astro 5.18.1, vanilla CSS variables (already in
`src/styles/theme.css`), Yarn, strict version pinning, no TypeScript, no
test framework — verification is `yarn build` plus rendered-HTML diff
checks against the pre-refactor output.

---

## File structure

| Action  | Path                                          | Responsibility |
| ------- | --------------------------------------------- | -------------- |
| Create  | `src/layouts/BooksLayout.astro`               | Renders /livres listing: main books list, nested per-book reviews, translated_books and book_chapters sub-sections, data-sets cross-reference. Locale-specific UI strings from a `t = locale === 'en' ? ... : ...` object. Books-specific CSS rules in a scoped `<style>` block. |
| Create  | `src/layouts/PublicationsLayout.astro`        | Renders /publications listing: optional intro link, year-grouped articles, technical_reports, communications (international + national sub-sections). Publications-specific CSS rules in a scoped `<style>` block. |
| Modify  | `src/pages/[...slug].astro`                   | Drops from 170 LOC to ~50 LOC. Becomes a thin dispatcher: read `entry.data.page_layout`, render the matching layout. Render `<Content />` is captured once and passed as a prop. |
| Modify  | `src/pages/en/[...slug].astro`                | Same shape as the FR route, with `locale="en"` passed to layouts and the EN `*/en.md` glob. |
| Modify  | `src/content/config.mjs`                      | Widen `page_layout` enum from `['home']` to `['home', 'books', 'publications']`. Drop the now-redundant `listing` field. |
| Modify  | `content/pages/livres/fr.md`                  | Rename `listing: books` → `page_layout: books`. |
| Modify  | `content/pages/livres/en.md`                  | Same. |
| Modify  | `content/pages/publications/fr.md`            | Rename `listing: publications` → `page_layout: publications`. |
| Modify  | `content/pages/publications/en.md`            | Same. |
| Modify  | `src/styles/theme.css`                        | Remove listing-specific rules now scoped in the new layouts. Keep shared rules: `.listing-section`, `.listing-subsection`, table styling, typography tokens, `body::before`, header/footer, `h1` global, `.container` and `.oped` widths. |
| Modify  | `CLAUDE.md`                                   | Update "Content model" section to describe the unified `page_layout` discriminator and the new layout components. |

## Conventions

- **No commit steps in this plan.** The user's global rule is "never commit
  or push automatically." Each task ends with a `yarn build` + spot-check
  verification; the user reviews and commits manually.
- **Each task is independently buildable.** Site stays functionally identical
  throughout — the only intermediate state is the "after Task 3 before Task
  4" moment, where the schema accepts `page_layout: books` but no data file
  uses it yet (no-op, still buildable).
- **Per-locale atomicity.** Tasks 4 and 5 each touch ONE locale (FR or EN)
  end-to-end (data file + route file) so the locale stays internally
  consistent through every transition.

---

## Tasks

### Task 1: Create `BooksLayout.astro`

**Files:**
- Create: `src/layouts/BooksLayout.astro`

- [ ] **Step 1: Write the full layout component**

Create `src/layouts/BooksLayout.astro` with the EXACT content below. Notes
on the design that the implementer should not improvise:

- Layout accepts `{ entry, locale, Content }` props. `Content` comes from
  the catch-all route's `(await render(entry)).Content` — pass it as a
  prop instead of re-deriving (HomeLayout follows the same pattern).
- Locale-specific UI strings (`éditeur`/`publisher`, `recension`/`book
  review`, `Revues critiques`/`Book reviews`, `par`/`by`) come from a
  single `t = locale === 'en' ? ... : ...` object at the top of the
  frontmatter script.
- The `localePrefix` constant (`'en/'` or empty) is built once and used
  when constructing `page_slug` hrefs. EN URLs include `en/`, FR don't.
- All books-listing CSS lives in the scoped `<style>` block. The
  `.listing-section` rule used by translated_books / book_chapters
  headings stays in `theme.css` (shared between both new layouts).

```astro
---
import BaseLayout from './BaseLayout.astro';

const { entry, locale, Content } = Astro.props;
const data = entry.data;

// Locale-specific UI labels for the books listing.
const t = locale === 'en'
  ? { editor: 'publisher', bookReview: 'book review', reviewsLabel: 'Book reviews', by: 'by' }
  : { editor: 'éditeur',   bookReview: 'recension',   reviewsLabel: 'Revues critiques', by: 'par' };

// Prefix prepended to internal hrefs (page_slug links) on the EN locale.
const localePrefix = locale === 'en' ? 'en/' : '';

const booksData = (data.books ?? []).slice().sort((a, b) => b.year - a.year);
---

<BaseLayout
  title={data.title}
  locale={locale}
  description={data.description}
  keywords={data.keywords}
>
  <Content />
  <ul class="book-list">
    {booksData.map(b => (
      <li>
        {b.page_slug
          ? <a href={`${import.meta.env.BASE_URL}${localePrefix}${b.page_slug}`}><strong>{b.title}</strong></a>
          : <strong>{b.title}</strong>}
        — {b.authors.map((a, i) => (
          <>{i > 0 && ', '}{a.startsWith('Le Roux') ? <strong>{a}</strong> : a}</>
        ))}, <em>{b.publisher}</em>, {b.year}
        {b.external && <> · <a href={b.external}>{t.editor}</a></>}
        {b.book_review_url && <> · <a href={b.book_review_url}>{t.bookReview}</a></>}
        {b.reviews && b.reviews.length > 0 && (
          <>
            <div class="reviews-label">{t.reviewsLabel}</div>
            <ul class="review-list">
              {b.reviews.map(r => (
                <li>
                  <em><a href={r.url}>{r.venue}</a></em> {t.by} {r.reviewer} ({r.year})
                </li>
              ))}
            </ul>
          </>
        )}
      </li>
    ))}
  </ul>
  {data.translated_books && data.translated_books.length > 0 && (
    <>
      <h2 class="listing-section">{data.translated_books_title}</h2>
      <ul class="book-list">
        {data.translated_books.slice().sort((a, b) => b.year - a.year).map(tb => (
          <li set:html={tb.text_html}></li>
        ))}
      </ul>
    </>
  )}
  {data.book_chapters && data.book_chapters.length > 0 && (
    <>
      <h2 class="listing-section">{data.book_chapters_title}</h2>
      <ul class="book-list">
        {data.book_chapters.slice().sort((a, b) => b.year - a.year).map(c => (
          <li set:html={c.text_html}></li>
        ))}
      </ul>
    </>
  )}
  {data.data_sets_link_html && (
    <p class="data-sets-link" set:html={data.data_sets_link_html}></p>
  )}
</BaseLayout>

<style>
  /* Books listing — main book entries and translated-books / book-chapters lists. */
  .book-list { list-style: none; padding: 0; margin: 0; }
  .book-list li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-display);
    font-size: 15px;
    line-height: 1.55;
  }

  /* Inline reviews nested under a book entry — "Revues critiques" / "Book reviews". */
  .reviews-label {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .22em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 10px 0 4px;
  }
  .review-list {
    list-style: disc;
    padding: 0 0 0 22px;
    margin: 0 0 6px;
  }
  /* Defined here (scoped) so it wins over the parent .book-list li padding/border. */
  .review-list li {
    padding: 2px 0;
    border-bottom: none;
    font-family: var(--font-display);
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .review-list em { font-style: italic; }
  .review-list a { color: var(--text); }
  .review-list a:hover { color: var(--accent); }

  /* Bottom-of-page cross-reference ("Fichiers de données : cliquer ici"). */
  .data-sets-link {
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 36px 0 0;
  }
  .data-sets-link a { color: var(--text); }
  .data-sets-link a:hover { color: var(--accent); }
</style>
```

- [ ] **Step 2: Verify the build still passes**

Run: `yarn build`
Expected: build succeeds, 23 pages built. `BooksLayout.astro` is now an
orphan component (no route imports it yet) — no behavioural change.

---

### Task 2: Create `PublicationsLayout.astro`

**Files:**
- Create: `src/layouts/PublicationsLayout.astro`

- [ ] **Step 1: Write the full layout component**

Create `src/layouts/PublicationsLayout.astro` with the EXACT content below.
Design notes:

- Same prop shape as BooksLayout: `{ entry, locale, Content }`.
- Locale strings limited to the publications listing's needs:
  `see` (`voir`/`see`) and `external` (`lien`/`link`). `PDF` is the same in
  both locales.
- `localePrefix` builds the `see_book_slug` href the same way as in
  BooksLayout — EN gets `en/` prefix, FR doesn't.
- Year-grouping logic moves from the route into the layout: group
  publications by year, sort year-desc, emit a `<h3 class="pub-year-group">`
  before each group.
- All publications-listing CSS lives in the scoped `<style>` block.
  `.listing-section` and `.listing-subsection` rules stay in `theme.css`
  (shared with BooksLayout).

```astro
---
import BaseLayout from './BaseLayout.astro';

const { entry, locale, Content } = Astro.props;
const data = entry.data;

// Locale-specific UI labels for the publications listing.
const t = locale === 'en'
  ? { see: 'see',  external: 'link' }
  : { see: 'voir', external: 'lien' };

// Prefix prepended to internal hrefs (see_book_slug links) on the EN locale.
const localePrefix = locale === 'en' ? 'en/' : '';

const publicationsData = (data.publications ?? []).slice().sort((a, b) => b.year - a.year);

// Group publications by year for the year-marker rendering.
const publicationsByYear = publicationsData.reduce((acc, p) => {
  (acc[p.year] ||= []).push(p);
  return acc;
}, {});
const publicationYearsDesc = Object.keys(publicationsByYear).sort((a, b) => Number(b) - Number(a));
---

<BaseLayout
  title={data.title}
  locale={locale}
  description={data.description}
  keywords={data.keywords}
>
  <Content />
  {data.intro_link_html && (
    <p class="pub-intro-link" set:html={data.intro_link_html}></p>
  )}
  {publicationYearsDesc.map(year => (
    <>
      <h3 class="pub-year-group">{year}</h3>
      <ul class="publication-list">
        {publicationsByYear[year].map(p => (
          <li>
            <span class="pub-authors">{p.authors.map((a, i) => (
              <>{i > 0 && ', '}{a.startsWith('Le Roux') ? <strong>{a}</strong> : a}</>
            ))}</span>
            <span class="pub-title">{p.title}</span>
            {p.venue && <span class="pub-venue"><em>{p.venue}</em></span>}
            {p.pages && <span class="pub-pages">, {p.pages}</span>}
            {p.see_book_slug && p.see_book_label && (
              <> · <a href={`${import.meta.env.BASE_URL}${localePrefix}${p.see_book_slug}`}>{t.see} {p.see_book_label}</a></>
            )}
            {p.pdf && <> · <a href={p.pdf}>PDF</a></>}
            {p.external && <> · <a href={p.external}>{t.external}</a></>}
          </li>
        ))}
      </ul>
    </>
  ))}
  {data.technical_reports && data.technical_reports.length > 0 && (
    <>
      <h2 class="listing-section">{data.technical_reports_title}</h2>
      <ul class="publication-list">
        {data.technical_reports.slice().sort((a, b) => b.year - a.year).map(r => (
          <li set:html={r.text_html}></li>
        ))}
      </ul>
    </>
  )}
  {(data.communications_international || data.communications_national) && (
    <>
      {data.communications_title && (
        <h2 class="listing-section">{data.communications_title}</h2>
      )}
      {data.communications_international && data.communications_international.length > 0 && (
        <>
          <h3 class="listing-subsection">{data.communications_international_title}</h3>
          <ul class="publication-list">
            {data.communications_international.slice().sort((a, b) => b.year - a.year).map(c => (
              <li set:html={c.text_html}></li>
            ))}
          </ul>
        </>
      )}
      {data.communications_national && data.communications_national.length > 0 && (
        <>
          <h3 class="listing-subsection">{data.communications_national_title}</h3>
          <ul class="publication-list">
            {data.communications_national.slice().sort((a, b) => b.year - a.year).map(c => (
              <li set:html={c.text_html}></li>
            ))}
          </ul>
        </>
      )}
    </>
  )}
</BaseLayout>

<style>
  /* Publications listing — articles, technical reports, communications. */
  .publication-list { list-style: none; padding: 0; margin: 0; }
  .publication-list li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-display);
    font-size: 15px;
    line-height: 1.55;
  }

  /* Per-entry inline labels — accent year (used by older renderings),
     muted authors, italic venue. */
  .pub-year {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .15em;
    text-transform: uppercase;
    color: var(--accent);
    margin-right: 10px;
  }
  .pub-authors { color: var(--text-muted); margin-right: 6px; font-size: 14px; }
  .pub-title { font-weight: 500; }
  .pub-venue { font-style: italic; color: var(--text-muted); font-size: 14px; }

  /* Year-group marker between sorted year groups in the articles list. */
  .pub-year-group {
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .2em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 22px 0 6px;
  }

  /* Intro-link paragraph cross-reference. */
  .pub-intro-link {
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 8px 0 24px;
  }
  .pub-intro-link a { color: var(--text); }
  .pub-intro-link a:hover { color: var(--accent); }
</style>
```

- [ ] **Step 2: Verify the build still passes**

Run: `yarn build`
Expected: build succeeds, 23 pages built. `PublicationsLayout.astro` is
also still an orphan — no route imports it yet.

---

### Task 3: Widen `page_layout` enum in the schema

**Files:**
- Modify: `src/content/config.mjs` (the existing `page_layout` field, around line 26)

- [ ] **Step 1: Widen the enum**

In `src/content/config.mjs`, locate the existing line:

```js
    page_layout: z.enum(['home']).optional(),
```

Replace with:

```js
    page_layout: z.enum(['home', 'books', 'publications']).optional(),
```

Keep the `listing` field in the schema for now — it will be dropped in
Task 6 once all data files have been migrated to `page_layout`.

- [ ] **Step 2: Verify the build still passes**

Run: `yarn build`
Expected: build succeeds, 23 pages built. No data file uses
`page_layout: books` or `page_layout: publications` yet, so this is a
no-op behaviourally — just a wider validator.

---

### Task 4: Atomic flip for FR — route + data files

This task moves the FR locale's listing pages off the `listing` discriminator
and onto the new layouts in one atomic step. Both the FR route and the
two FR markdown files change together so the FR locale never enters a
half-migrated state.

**Files:**
- Modify (REPLACE FULL CONTENTS): `src/pages/[...slug].astro`
- Modify: `content/pages/livres/fr.md` (one line)
- Modify: `content/pages/publications/fr.md` (one line)

- [ ] **Step 1: Replace `src/pages/[...slug].astro` with the new dispatcher**

Replace the entire contents of `src/pages/[...slug].astro` with:

```astro
---
import { getEntry, render } from 'astro:content';
import PageLayout from '../layouts/PageLayout.astro';
import HomeLayout from '../layouts/HomeLayout.astro';
import BooksLayout from '../layouts/BooksLayout.astro';
import PublicationsLayout from '../layouts/PublicationsLayout.astro';

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

// Single discriminator — entry.data.page_layout — selects which layout
// renders the page. Plain markdown pages omit the field and fall through
// to PageLayout.
const layout = entry.data.page_layout;
const { Content } = await render(entry);
---

{layout === 'home' ? (
  <HomeLayout entry={entry} Content={Content} locale="fr" />
) : layout === 'books' ? (
  <BooksLayout entry={entry} Content={Content} locale="fr" />
) : layout === 'publications' ? (
  <PublicationsLayout entry={entry} Content={Content} locale="fr" />
) : (
  <PageLayout title={entry.data.title} locale="fr" description={entry.data.description} keywords={entry.data.keywords}>
    <Content />
  </PageLayout>
)}
```

- [ ] **Step 2: Rename the FR books-page discriminator**

In `content/pages/livres/fr.md`, change the line:

```yaml
listing: books
```

to:

```yaml
page_layout: books
```

- [ ] **Step 3: Rename the FR publications-page discriminator**

In `content/pages/publications/fr.md`, change the line:

```yaml
listing: publications
```

to:

```yaml
page_layout: publications
```

- [ ] **Step 4: Build verification**

Run: `yarn build`
Expected: build succeeds. All 23 pages built. No content-collection
validation errors.

- [ ] **Step 5: Capture pre-refactor HTML for the FR listing pages**

Before this task ran, the rendered HTML for `/livres/` and `/publications/`
was generated by the inline render blocks in the old route. After this task
runs, it's generated by the new layouts. The visible output should be
identical (modulo Astro `data-astro-cid-*` attribute selectors on scoped
CSS classes).

Compare key parts of the rendered output to confirm:

```bash
python3 -c "
import re
for url in ['publications', 'livres']:
    with open(f'dist/{url}/index.html') as f:
        h = f.read()
    body = h[h.find('<main'):h.find('</main>') + 7]
    # Strip Astro cid attributes so the diff is meaningful.
    stripped = re.sub(r' data-astro-cid-[a-z0-9]+=\"?[a-z0-9]*\"?', '', body)
    print(f'== /{url}/ (stripped of cid attrs) — first 800 chars ==')
    print(stripped[:800])
    print()
"
```

Expected: the output contains the listing-page structure (year-group
headers, books entries, listing-section subsections) — same shape as
before the refactor.

---

### Task 5: Atomic flip for EN — route + data files

Mirror Task 4 for the EN locale.

**Files:**
- Modify (REPLACE FULL CONTENTS): `src/pages/en/[...slug].astro`
- Modify: `content/pages/livres/en.md` (one line)
- Modify: `content/pages/publications/en.md` (one line)

- [ ] **Step 1: Replace `src/pages/en/[...slug].astro` with the new dispatcher**

Replace the entire contents of `src/pages/en/[...slug].astro` with:

```astro
---
import { getEntry, render } from 'astro:content';
import PageLayout from '../../layouts/PageLayout.astro';
import HomeLayout from '../../layouts/HomeLayout.astro';
import BooksLayout from '../../layouts/BooksLayout.astro';
import PublicationsLayout from '../../layouts/PublicationsLayout.astro';

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

const layout = entry.data.page_layout;
const { Content } = await render(entry);
---

{layout === 'home' ? (
  <HomeLayout entry={entry} Content={Content} locale="en" />
) : layout === 'books' ? (
  <BooksLayout entry={entry} Content={Content} locale="en" />
) : layout === 'publications' ? (
  <PublicationsLayout entry={entry} Content={Content} locale="en" />
) : (
  <PageLayout title={entry.data.title} locale="en" description={entry.data.description} keywords={entry.data.keywords}>
    <Content />
  </PageLayout>
)}
```

- [ ] **Step 2: Rename the EN books-page discriminator**

In `content/pages/livres/en.md`, change the line:

```yaml
listing: books
```

to:

```yaml
page_layout: books
```

- [ ] **Step 3: Rename the EN publications-page discriminator**

In `content/pages/publications/en.md`, change the line:

```yaml
listing: publications
```

to:

```yaml
page_layout: publications
```

- [ ] **Step 4: Build verification**

Run: `yarn build`
Expected: build succeeds. All 23 pages built.

- [ ] **Step 5: Confirm EN listings render**

Run:

```bash
python3 -c "
import re
for url in ['en/publications', 'en/livres']:
    with open(f'dist/{url}/index.html') as f:
        h = f.read()
    body = h[h.find('<main'):h.find('</main>') + 7]
    print(f'== /{url}/ — first 600 chars (with cid attrs to verify scope) ==')
    print(body[:600])
    print()
"
```

Expected: EN page bodies contain listing structure with English labels
(`book review`, `Book reviews`, `by`, `see`, `link`) appearing where the
locale-specific strings render.

- [ ] **Step 6: Cross-locale verification**

Spot-check by counting key markers:

```bash
python3 << 'EOF'
import re
for url in ['publications/', 'en/publications/', 'livres/', 'en/livres/']:
    with open(f'dist/{url}index.html') as f:
        h = f.read()
    year_groups = len(re.findall(r'pub-year-group', h))
    le_roux_bold = len(re.findall(r'<strong>Le Roux', h))
    listing_section = len(re.findall(r'listing-section"', h))
    print(f'/{url}: pub-year-group={year_groups}, <strong>Le Roux={le_roux_bold}, listing-section={listing_section}')
EOF
```

Expected:
- `/publications/` and `/en/publications/` should report `pub-year-group=23`
  and `listing-section=2` (Rapports + Communications).
- `/livres/` and `/en/livres/` should report `listing-section=2` (Translated
  books + Book chapters) and `pub-year-group=0`.
- All four URLs should show many `<strong>Le Roux` matches (the bold-rule
  for the surname).

---

### Task 6: Drop `listing` field from the schema

Now that all four data files use `page_layout`, the `listing` field is
unused everywhere. Remove it from the schema for clean cut.

**Files:**
- Modify: `src/content/config.mjs` (the `listing` field, around line 20)

- [ ] **Step 1: Remove the `listing` field**

In `src/content/config.mjs`, locate and delete:

```js
    // optional field to trigger data-driven listing below the markdown body
    listing: z.enum(['books', 'publications']).optional(),
```

Surrounding context after the deletion should read:

```js
    keywords: z.string().optional(),
    // Home-only structured fields. Present when `page_layout: home` is set in
    // frontmatter; HomeLayout.astro reads them. They are .optional() at the
    // schema level so the rest of the page collection keeps validating.
```

(The comment about "data-driven listing" referred to the old `listing`
field. The `page_layout` field continues to serve the same role; its
comment block is unchanged.)

- [ ] **Step 2: Verify no markdown still uses `listing:`**

Run: `rtk proxy grep -rln "^listing:" content/pages/ || echo "(no matches — clean)"`
Expected: `(no matches — clean)`. If any file still has `listing:` the
schema removal will trigger validation errors on the next build.

- [ ] **Step 3: Build verification**

Run: `yarn build`
Expected: build succeeds. All 23 pages built. No content-collection
validation errors.

---

### Task 7: CSS migration — remove listing-specific rules from `theme.css`

The scoped `<style>` blocks in BooksLayout and PublicationsLayout already
define the listing-specific rules. The duplicate rules in `theme.css` are
now redundant (Astro scoping gives the in-component rules higher specificity,
so they win on conflict — but identical values, no visible change). Remove
them from `theme.css` to leave the global stylesheet focused on site-wide
concerns.

**Files:**
- Modify: `src/styles/theme.css` (remove blocks identified below)

- [ ] **Step 1: Remove the books-specific rules from `theme.css`**

Locate and delete the entire `.book-list` / `.reviews-label` / `.review-list` /
`.data-sets-link` block. In the current file these appear together (added
during the books-page restoration). Find this section:

```css
/* Publication lists */
.book-list,
.publication-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.book-list li,
.publication-list li {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 1.55;
}
```

Remove `.book-list,` from the first selector list and `.book-list li,`
from the second, so they become:

```css
/* Publications list — main entries on /publications. */
.publication-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.publication-list li {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 1.55;
}
```

- [ ] **Step 2: Remove the publications-specific rules from `theme.css`**

Now also remove the publications-only rules from `theme.css`. Find the
block(s) starting with `.pub-year`, `.pub-authors`, `.pub-title`,
`.pub-venue`, `.pub-year-group`, `.pub-intro-link`, and delete them.

The exact text varies based on recent edits — search for:

```css
/* Year in accent color, Bricolage uppercase — editorial byline style */
.pub-year {
```

Delete from that comment through the closing brace of `.pub-venue { ... }`
(four rules: `.pub-year`, `.pub-authors`, `.pub-title`, `.pub-venue`).

Also delete the `.pub-year-group { ... }` rule and the
`.pub-intro-link { ... }` rule (plus its `.pub-intro-link a`,
`.pub-intro-link a:hover` descendants).

Also delete the `.publication-list` rules added in Step 1 if they're still
there (now they're in PublicationsLayout's scoped block).

Wait — `.publication-list` is needed in `theme.css` too? **No.** Both books
and publications scoped layouts include `.publication-list` (BooksLayout
doesn't actually need it; only PublicationsLayout uses it). After Step 1
above, this rule should also be removed from `theme.css` and exists only
in PublicationsLayout. Re-read theme.css and confirm there's no remaining
`.publication-list` rule.

- [ ] **Step 3: Remove the books-only rules from `theme.css`**

Find and delete:

```css
/* Inline book reviews nested under a book entry in .book-list. Mirrors the
   legacy site's "Revues critiques" / "Book reviews" treatment. */
.reviews-label { /* ... */ }
.review-list { /* ... */ }
.review-list li { /* ... */ }
.review-list em { /* ... */ }
.review-list a { /* ... */ }
.review-list a:hover { /* ... */ }
```

Also find and delete:

```css
.data-sets-link { /* ... */ }
.data-sets-link a { /* ... */ }
.data-sets-link a:hover { /* ... */ }
```

- [ ] **Step 4: Keep these in `theme.css` — shared rules**

The following must REMAIN in `theme.css` (they are shared between layouts
or used by other pages):

- `.listing-section` and `.listing-section::before`, `.listing-section::after`
  (centered tracked caps with flanking hairlines)
- `.listing-subsection` and `.listing-subsection::before`
  (vermillion bar + italic Fraunces)
- `table` and descendants (`thead th`, `tbody td`, etc.) — used by
  /ateliers, /cv, and the book detail pages
- All typography tokens, `body::before`, header/footer rules,
  `.container` / `.oped` widths, `h1` global, `.lm-kicker`, `.pub-pages`
  (it's also in publications, but harmless to keep), language picker
  styles, responsive `@media` block

Note: `.pub-pages` doesn't appear in `theme.css` to begin with (it was
added in PublicationsLayout's scoped block from the start). If you find
it there, leave it — but it's expected to only exist in the layout.

- [ ] **Step 5: Build verification**

Run: `yarn build`
Expected: build succeeds.

- [ ] **Step 6: Visual parity check**

Run: `yarn dev` in a separate terminal (it should keep running).

Compare the rendered output before vs after Task 7 by visiting:

- http://localhost:4321/livres/
- http://localhost:4321/en/livres/
- http://localhost:4321/publications/
- http://localhost:4321/en/publications/

The pages should look visually identical to before Task 7 (and before the
whole refactor). The Astro-scoped `data-astro-cid-*` attributes appear in
the HTML, but the rendered visual is unchanged because the rule values
moved from global to scoped — same values, same output.

If something LOOKS different, the most likely cause is that a rule that
should have moved was deleted but never added to the scoped block (or vice
versa). Re-check Steps 1–4.

- [ ] **Step 7: Grep verification**

Run:

```bash
rtk proxy grep -nE "\.book-list|\.reviews-label|\.review-list|\.data-sets-link|\.publication-list|\.pub-year|\.pub-authors|\.pub-title|\.pub-venue|\.pub-year-group|\.pub-intro-link" src/styles/theme.css
```

Expected: no output (zero matches in `theme.css`). All listing-specific
rules have moved into the scoped layouts.

---

### Task 8: Documentation update

**Files:**
- Modify: `CLAUDE.md` (the "Content model" section)

- [ ] **Step 1: Update the Content model section**

In `CLAUDE.md`, locate the "Content model" section. It currently describes
the `listing:` field as a discriminator. Update the description to reflect
the unified `page_layout` discriminator.

Find this passage (approximately):

```
- Common: `title`, `locale`, `slug`, optional `description`, optional
  `keywords`.
- Listing pages: optional `listing: books|publications` (discriminator),
  plus an inline `books:` or `publications:` array carrying the entries
  themselves.
```

Replace with:

```
- Common: `title`, `locale`, `slug`, optional `description`, optional
  `keywords`.
- Page layout discriminator (optional): `page_layout: home | books |
  publications`. When set, the catch-all route routes the entry to the
  matching dedicated layout (`HomeLayout`, `BooksLayout`,
  `PublicationsLayout`). When omitted, the page renders via the default
  `PageLayout`. Listing pages also carry their inline `books:` or
  `publications:` array as before.
```

The home-only fields block immediately below should keep its existing
description (page_layout: home is one of the values it triggers).

- [ ] **Step 2: Verify the docs are consistent**

Read the updated CLAUDE.md section and confirm:
- No remaining references to `listing:` as a discriminator
- The `page_layout` enum values listed match the schema (`home | books |
  publications`)
- The "Adding a new book / publication" section (further down) still reads
  correctly (it references `livres/{fr,en}.md` and `publications/{fr,en}.md`
  but should not mention the `listing` field)

If the "Adding a new book / publication" section still has any `listing:`
reference, remove it.

---

### Task 9: Final acceptance check

**Files:** none (verification only).

- [ ] **Step 1: Build clean**

Run: `yarn build`
Expected: build succeeds, 23 pages built, no warnings.

- [ ] **Step 2: Verify route line counts**

Run:

```bash
rtk proxy wc -l src/pages/\[...slug\].astro src/pages/en/\[...slug\].astro
```

Expected: each route is ≤ 60 lines (the spec target was ~50 LOC).

- [ ] **Step 3: Verify no listing-rendering leakage in routes**

Run:

```bash
rtk proxy grep -E "book-list|publication-list|pub-year|publicationsByYear|booksData" src/pages/\[...slug\].astro src/pages/en/\[...slug\].astro || echo "(no matches — routes are clean dispatchers)"
```

Expected: `(no matches — routes are clean dispatchers)`. All listing
rendering logic now lives in the layouts.

- [ ] **Step 4: Verify no `listing:` field anywhere**

Run:

```bash
rtk proxy grep -rln "^listing:\|listing: z\." content/pages/ src/content/ || echo "(no matches — clean)"
```

Expected: `(no matches — clean)`. The `listing` field is gone from both
data files and the schema.

- [ ] **Step 5: Spot-check each affected URL**

Start `yarn dev` if not already running. Visit:

| URL | What to verify |
| --- | --- |
| `http://localhost:4321/` | Home page unchanged (still renders via HomeLayout) |
| `http://localhost:4321/livres/` | Books listing: 9 books year-desc, GDA reviews nested, translated_books section, book_chapters section, "Fichiers de données" link at bottom |
| `http://localhost:4321/en/livres/` | EN mirror: "publisher", "book review", "Book reviews", "by" — locale-specific labels render |
| `http://localhost:4321/publications/` | 23 year-group headers (2017 → 1973), 40 articles, Rapports techniques section, Communications section with Internationales/Nationales sub-sections |
| `http://localhost:4321/en/publications/` | EN mirror: "see X", "link" — locale-specific labels render |
| `http://localhost:4321/recherches/` | Plain markdown page, unchanged (renders via PageLayout) |
| `http://localhost:4321/cv/` | Plain markdown page with table, unchanged |
| `http://localhost:4321/ateliers/` | Plain markdown page with table, unchanged |
| `http://localhost:4321/livres/cigda/` | Book detail page, unchanged |

For each, confirm: layout matches the pre-refactor visual, no error
console messages, all links work.

- [ ] **Step 6: Acceptance criteria checklist from the spec**

Go through each acceptance criterion from
`docs/superpowers/specs/2026-05-17-listing-layouts-design.md` and mark
PASS / FAIL. Record results for the PR description:

1. `yarn build` succeeds; all 23 pages built; no warnings.
2. On every URL, visible rendered content matches the pre-refactor output.
3. `src/pages/[...slug].astro` and `src/pages/en/[...slug].astro` are each
   ≤ 60 LOC of dispatch logic only.
4. All listing rendering logic lives in `BooksLayout.astro` and
   `PublicationsLayout.astro`. `grep` in `src/pages/` returns no listing-
   rendering hits.
5. No remaining `listing:` field in any markdown file or in the content
   schema.
6. CSS rules from the migration table moved as specified.
7. Pages outside the three layouts continue to render via `PageLayout`
   with identical output.
8. FR/EN parity: the two locale routes are byte-identical except for the
   locale string and URL glob path.

If any criterion fails, open a follow-up task to fix before merging.

---

## Summary

After Task 8, the codebase shape is:

```
src/
├── pages/
│   ├── [...slug].astro              # ~45 LOC dispatcher
│   └── en/[...slug].astro           # ~45 LOC dispatcher
├── layouts/
│   ├── BaseLayout.astro             # unchanged (81 LOC)
│   ├── PageLayout.astro             # unchanged (12 LOC)
│   ├── HomeLayout.astro             # unchanged (274 LOC)
│   ├── BooksLayout.astro            # NEW (~140 LOC, with scoped style)
│   └── PublicationsLayout.astro     # NEW (~160 LOC, with scoped style)
└── content/
    └── config.mjs                   # `listing` removed; `page_layout` enum widened
```

`theme.css` carries only site-wide rules: tokens, header/footer, masthead
rule, container widths, global `h1`, `.listing-section`,
`.listing-subsection`, table styling, language picker, responsive collapse.

`content/pages/{livres,publications}/{fr,en}.md` each have one line changed
(`listing` → `page_layout`).

Net: 2 new files, 7 modified files (4 markdown, 2 routes, schema, theme.css,
CLAUDE.md). ~380 lines added (new layouts), ~300 lines removed (route
dedup + CSS migration). Net same code volume; far less duplication.

No commits inside the plan — the user reviews and commits manually per
their global rule.
