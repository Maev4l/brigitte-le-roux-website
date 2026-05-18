# Listing layouts — extraction design

**Date:** 2026-05-17
**Scope:** Extract /livres and /publications listing rendering from the
catch-all routes into dedicated Astro layout components
(`BooksLayout.astro`, `PublicationsLayout.astro`). Pure refactor — the
rendered HTML stays visually identical. Sets up future per-page visual
treatments without precommitting to them.

## Goals

1. **Eliminate FR/EN render-block duplication.** Today every listing
   change requires editing two near-identical render blocks in
   `src/pages/[...slug].astro` and `src/pages/en/[...slug].astro`. After
   extraction, the rendering lives in one place per listing.
2. **Shrink the catch-all routes** from ~170 LOC of mixed dispatch + render
   to ~50 LOC of pure dispatch. Each route becomes a thin layout selector.
3. **Co-locate listing-specific CSS** with the layout that owns it, getting
   the bulk of it out of `theme.css`'s global cascade.
4. **Match the existing `HomeLayout.astro` extraction pattern** for
   consistency — that precedent already demonstrates this approach works.

## Non-goals

- **Visual changes** to /livres or /publications. The rendered output is
  visually identical before and after. Scoped CSS will introduce
  `data-astro-cid-*` attribute selectors on the migrated rules, but the
  visual result is unchanged.
- **Per-page layouts** for non-listing pages (/cv, /ateliers, /recherches,
  /these, /logiciels, /bureau). Those stay on `PageLayout` for now. Each
  can get its own design exercise in a follow-up cycle if desired.
- **Data shape changes** beyond a single discriminator rename. See
  Architecture § "Schema change".

## Constraints

- Astro 5, no TypeScript, no new dependencies.
- Strict version pinning preserved (no `package.json` change).
- All current URL paths unchanged.
- `yarn build` succeeds with the same 23-page count.
- No regression on any page outside /livres and /publications.

## Architecture

### Layout dispatch — today vs proposed

**Today** — routes read two separate discriminator fields and inline two
~50-line render blocks:

```js
const isHome = entry.data.page_layout === 'home';
const listing = entry.data.listing;            // 'books' | 'publications'
```

```jsx
{isHome ? <HomeLayout entry={entry} Content={Content} locale="fr" /> :
  <PageLayout title={entry.data.title} locale="fr" description={entry.data.description}>
    <Content />
    {listing === 'books' && (
      /* ~50 LOC: main books list, translated books, book chapters, data-sets link */
    )}
    {listing === 'publications' && (
      /* ~65 LOC: intro link, year-grouped articles, technical reports, communications */
    )}
  </PageLayout>}
```

**Proposed** — one discriminator, one dispatch:

```js
const layout = entry.data.page_layout;
```

```jsx
{layout === 'home' ?         <HomeLayout         entry={entry} Content={Content} locale="fr" /> :
 layout === 'books' ?        <BooksLayout        entry={entry} Content={Content} locale="fr" /> :
 layout === 'publications' ? <PublicationsLayout entry={entry} Content={Content} locale="fr" /> :
                             <PageLayout title={entry.data.title} locale="fr"
                                         description={entry.data.description}
                                         keywords={entry.data.keywords}><Content /></PageLayout>}
```

Same shape in the EN route, with `locale="en"` and the `en/` URL prefix
applied inside each layout where needed.

### Schema change — unify discriminators on `page_layout`

The current schema has two overlapping discriminators (`listing` and
`page_layout`). The refactor folds them into one: a widened `page_layout`
enum that includes the listing layouts.

```js
// BEFORE
listing:     z.enum(['books', 'publications']).optional(),
page_layout: z.enum(['home']).optional(),

// AFTER
page_layout: z.enum(['home', 'books', 'publications']).optional(),
// (listing field removed)
```

**Data-file changes** — one frontmatter line per file:

| File                                  | Was              | Becomes                |
| ------------------------------------- | ---------------- | ---------------------- |
| `content/pages/livres/fr.md`          | `listing: books` | `page_layout: books`   |
| `content/pages/livres/en.md`          | `listing: books` | `page_layout: books`   |
| `content/pages/publications/fr.md`    | `listing: publications` | `page_layout: publications` |
| `content/pages/publications/en.md`    | `listing: publications` | `page_layout: publications` |

The home pages already use `page_layout: home` — no change there.

### Component contract — identical shape for both new layouts

```typescript
interface Props {
  entry: CollectionEntry<'pages'>;
  locale: 'fr' | 'en';
  Content: AstroComponentFactory;  // from `(await render(entry)).Content`
}
```

Each layout:

1. Wraps `BaseLayout`, passing `title`, `locale`, `description`, `keywords`
   pulled from `entry.data`.
2. Renders `<Content />` first (the page's markdown intro body).
3. Renders the structured frontmatter listing data below.
4. Reads locale-specific UI strings via inline conditional at the top of
   the frontmatter script — the same pattern HomeLayout uses:

```js
const t = locale === 'en'
  ? { editor: 'publisher', bookReview: 'book review',
      reviewsLabel: 'Book reviews', by: 'by',
      see: 'see', external: 'link' }
  : { editor: 'éditeur',   bookReview: 'recension',
      reviewsLabel: 'Revues critiques', by: 'par',
      see: 'voir',  external: 'lien' };
```

### `BooksLayout.astro` responsibilities

**Reads from `entry.data`:**

- Standard page meta: `title`, `description`, `keywords`
- `books: BookItem[]` — main books array
- `translated_books_title`, `translated_books: TranslatedBookItem[]`
- `book_chapters_title`, `book_chapters: BookChapterItem[]`
- `data_sets_link_html`

**Renders, in order:**

1. Intro `<Content />` — the page's markdown body.
2. Main books list (`<ul class="book-list">`). For each entry:
   - Title — wrapped in `<a href>` if `page_slug` present, plain `<strong>`
     otherwise.
   - Authors — entries starting with `Le Roux` wrapped in `<strong>`.
   - Publisher (italic), year.
   - Optional ` · <a>éditeur/publisher</a>` if `external` set.
   - Optional ` · <a>recension/book review</a>` if `book_review_url` set.
   - Optional nested reviews `<ul class="review-list">` if `reviews[]`
     non-empty, with a "Revues critiques" / "Book reviews" label.
3. Translated books section if `translated_books` non-empty — heading
   (`<h2 class="listing-section">{translated_books_title}</h2>`) plus flat
   `<ul class="book-list">` sorted year-desc, each entry rendered via
   `set:html={t.text_html}`.
4. Book chapters section if `book_chapters` non-empty — same shape.
5. Data-sets link `<p class="data-sets-link">` if `data_sets_link_html`
   present.

### `PublicationsLayout.astro` responsibilities

**Reads from `entry.data`:**

- Standard page meta: `title`, `description`, `keywords`
- `publications: PublicationItem[]` — main articles array
- `intro_link_html`
- `technical_reports_title`, `technical_reports: FreeProseItem[]`
- `communications_title`
- `communications_international_title`, `communications_international: FreeProseItem[]`
- `communications_national_title`, `communications_national: FreeProseItem[]`

**Renders, in order:**

1. Intro `<Content />` — the page's markdown body.
2. Optional `<p class="pub-intro-link" set:html={intro_link_html}>` if
   `intro_link_html` present.
3. Year-grouped articles. Group `publications` by year, sort year-desc.
   For each year group:
   - `<h3 class="pub-year-group">{year}</h3>`
   - `<ul class="publication-list">` with one `<li>` per entry. Each entry
     renders authors (Le Roux bolded), title, italic venue, optional pages,
     optional `voir`/`see <see_book_label>` link, optional PDF link,
     optional `lien`/`link`.
4. Technical reports section if `technical_reports` non-empty —
   `<h2 class="listing-section">{technical_reports_title}</h2>` plus flat
   `<ul class="publication-list">` with `set:html={text_html}` per entry,
   year-desc.
5. Communications section if either of the two communications arrays is
   non-empty:
   - `<h2 class="listing-section">{communications_title}</h2>`
   - International sub-section if `communications_international` non-empty:
     `<h3 class="listing-subsection">{communications_international_title}</h3>`
     plus list.
   - National sub-section if `communications_national` non-empty: same.

### CSS migration

Move listing-specific rules from `theme.css` into scoped `<style>` blocks
inside the corresponding layout. Shared rules used by both stay global.

| Rule                                  | Today         | Proposed                                    |
| ------------------------------------- | ------------- | ------------------------------------------- |
| `.book-list`                          | theme.css     | scoped in BooksLayout                       |
| `.reviews-label`                      | theme.css     | scoped in BooksLayout                       |
| `.review-list` + descendants          | theme.css     | scoped in BooksLayout                       |
| `.data-sets-link`                     | theme.css     | scoped in BooksLayout                       |
| `.publication-list`                   | theme.css     | scoped in PublicationsLayout                |
| `.pub-year`                           | theme.css     | scoped in PublicationsLayout                |
| `.pub-authors`, `.pub-title`, `.pub-venue`, `.pub-pages` | theme.css | scoped in PublicationsLayout |
| `.pub-year-group`                     | theme.css     | scoped in PublicationsLayout                |
| `.pub-intro-link`                     | theme.css     | scoped in PublicationsLayout                |
| `.listing-section`                    | theme.css     | **stays in theme.css** (used by both)       |
| `.listing-subsection`                 | theme.css     | **stays in theme.css** (used by both)       |
| `table` and descendants               | theme.css     | stays (also used on /ateliers, /cv, /livres/*) |
| All other theme.css rules             | theme.css     | unchanged                                   |

After migration, `theme.css` carries only site-wide concerns: typography
tokens, header / footer / nav / language picker, `body::before` masthead
rule, container widths, `h1` global, the shared `.listing-section` /
`.listing-subsection` separators, and table styling.

### File map

| Action  | Path                                          | Lines      |
| ------- | --------------------------------------------- | ---------- |
| Create  | `src/layouts/BooksLayout.astro`               | ~120       |
| Create  | `src/layouts/PublicationsLayout.astro`        | ~140       |
| Modify  | `src/pages/[...slug].astro`                   | 170 → ~50  |
| Modify  | `src/pages/en/[...slug].astro`                | 169 → ~50  |
| Modify  | `src/content/config.mjs`                      | unify enum |
| Modify  | `content/pages/livres/fr.md`                  | one line   |
| Modify  | `content/pages/livres/en.md`                  | one line   |
| Modify  | `content/pages/publications/fr.md`            | one line   |
| Modify  | `content/pages/publications/en.md`            | one line   |
| Modify  | `src/styles/theme.css`                        | remove ~80 LOC of listing CSS (moves into layouts) |
| Modify  | `CLAUDE.md`                                   | update Content model section to describe the new dispatch shape and renamed field |

## Acceptance criteria

- [ ] `yarn build` succeeds; all 23 pages built; no warnings.
- [ ] On every URL (`/`, `/en/`, `/livres`, `/en/livres`, `/publications`,
      `/en/publications`, plus every other page), the visible rendered
      content matches the pre-refactor output. CSS classes may gain Astro's
      `data-astro-cid-*` attribute selectors; rendered text, links, list
      structure, and visual layout are unchanged.
- [ ] `src/pages/[...slug].astro` and `src/pages/en/[...slug].astro` are
      each ≤ 60 LOC of dispatch logic only — no listing rendering inline.
- [ ] All listing rendering logic lives in `BooksLayout.astro` and
      `PublicationsLayout.astro`. `grep -E "book-list|publication-list"` in
      `src/pages/` returns no hits.
- [ ] No remaining `listing:` field in any markdown file or in the content
      schema.
- [ ] CSS rules listed in the migration table moved as specified. `grep`
      on `theme.css` for the listed rule names returns no hits for rules
      marked "scoped".
- [ ] Pages outside the three layouts (i.e. `/recherches`, `/these`, `/cv`,
      `/ateliers`, `/logiciels`, `/bureau`, book detail pages like
      `/livres/cigda`) continue to render via `PageLayout` with identical
      output to before.
- [ ] FR/EN parity: the two locale routes are byte-identical except for
      the locale string (`'fr'` vs `'en'`) passed to layouts and the URL
      glob path (`fr.md` vs `en.md`). No rendering logic duplicated.

## Out of scope

- Visual changes to /livres or /publications. Any visual redesign is a
  separate brainstorm.
- Per-page layouts for /cv, /ateliers, /recherches, /these, /logiciels,
  /bureau, or detail pages. Each gets its own cycle if redesigned.
- Adding additional listing types (e.g. /seminaires).
- Test framework introduction (none today; verification stays
  build-and-visual).

## Open questions

_None._ All design choices resolved during brainstorming.

## Reference

- Existing precedent: `src/layouts/HomeLayout.astro` (extracted similarly
  during the home-page rework). Spec at
  `docs/frontend-design/home-rework.md`; implementation plan at
  `docs/superpowers/plans/2026-05-17-home-oped-implementation.md`.
- Current listing data shapes and the conventions they use are documented
  in `CLAUDE.md` § "Content model".
