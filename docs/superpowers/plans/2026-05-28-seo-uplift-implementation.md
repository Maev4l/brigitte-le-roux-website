# SEO Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSON-LD structured data (Person, Book, ScholarlyArticle, WebSite, BreadcrumbList), self-host the two Google Fonts, wire conditional Google Search Console verification, and add per-page meta descriptions/keywords on the 6 highest-leverage pages.

**Architecture:** A single `content/identity.json` file holds locale-agnostic identity facts (name, affiliations, `sameAs` URLs). Pure schema builders in `src/lib/schema.mjs` map data → JSON-LD objects. One Astro component (`StructuredData.astro`) emits the `<script type="application/ld+json">` tag. Layouts inject the schemas they own (Base→Person, Home→+WebSite, Books→+Book[], Publications→+Article[], Page→+Breadcrumb when on a detail page).

**Tech Stack:** Astro 5.18 (static), Zod (via `astro:content`), Node `node:test` for unit tests (built-in, no new dep), variable WOFF2 fonts (Fraunces + Bricolage Grotesque, both SIL OFL — self-hosting permitted).

**Spec:** `docs/superpowers/specs/2026-05-28-seo-uplift-design.md`.

---

## Conventions

- **Working directory:** `/Users/jrsue/dev/repos/brigitte-leroux-website`. All paths below are relative to this root unless absolute.
- **Package manager:** `yarn`, run from the website package via `yarn --cwd packages/website ...` OR the root `yarn frontend:*` aliases.
- **Commit style:** Conventional Commits (`feat:`, `chore:`, `docs:`, `perf:`). No author co-trailer needed.
- **Lint:** Project has no ESLint config; skip lint steps.
- **Tests:** New `node:test` file at `packages/website/src/lib/schema.test.mjs`. Run via `yarn --cwd packages/website test:schema`.

---

## Task 1: Add identity data + Zod loader

**Files:**
- Create: `packages/website/content/identity.json`
- Create: `packages/website/src/lib/identity.mjs`

The identity file is locale-agnostic. The loader validates with Zod on import — if the JSON is malformed, the Astro build fails loudly instead of producing broken schema.

> **Note on spec deviation:** the spec §8 sketches placing `identitySchema` inside `src/content/config.mjs`. We instead colocate the schema with the import in `src/lib/identity.mjs`, because `identity.json` is a single file rather than a content collection — `config.mjs`'s `defineCollection` machinery would be overkill. Consumers import `{ identity }` and get a validated object in one step.

- [ ] **Step 1: Create the identity data file with empty `sameAs` initially**

Create `packages/website/content/identity.json`:

```json
{
  "name": "Brigitte Le Roux",
  "givenName": "Brigitte",
  "familyName": "Le Roux",
  "jobTitle": {
    "fr": "Chercheuse en analyse géométrique des données",
    "en": "Researcher in Geometric Data Analysis"
  },
  "affiliation": [
    { "name": "MAP5, Université Paris Cité", "url": "https://map5.mi.parisdescartes.fr/" },
    { "name": "CEVIPOF, CNRS / Sciences Po", "url": "https://www.sciencespo.fr/cevipof/" }
  ],
  "sameAs": []
}
```

The `sameAs` array stays empty for now — the editor populates it later (ORCID, Scholar, ResearchGate, institutional pages). An empty array is valid; the schema gracefully omits `sameAs` if empty.

- [ ] **Step 2: Create the Zod loader**

Create `packages/website/src/lib/identity.mjs`:

```js
// Single source of truth for the Person JSON-LD entity. Validated at module
// load so a malformed identity.json fails the Astro build rather than
// emitting silently broken structured data.
import { z } from 'astro:content';
import identityData from '../../content/identity.json';

const schema = z.object({
  name: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  jobTitle: z.object({ fr: z.string(), en: z.string() }),
  affiliation: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
  })),
  sameAs: z.array(z.string().url()),
});

export const identity = schema.parse(identityData);
```

- [ ] **Step 3: Verify import resolves by running the dev server briefly**

Run: `yarn --cwd packages/website build`
Expected: PASS, no schema validation error. (Nothing consumes `identity.mjs` yet — but the import at module load doesn't fail.)

- [ ] **Step 4: Commit**

```bash
git add packages/website/content/identity.json packages/website/src/lib/identity.mjs
git commit -m "feat(seo): add identity data file and Zod loader"
```

---

## Task 2: Schema builders + tests

**Files:**
- Create: `packages/website/src/lib/schema.mjs`
- Create: `packages/website/src/lib/schema.test.mjs`
- Modify: `packages/website/package.json` (add `test:schema` script)

Pure functions, no Astro dependency. Each builder returns a plain JS object (or array). Fields with no value are omitted so partial data ships fine.

- [ ] **Step 1: Write the failing test**

Create `packages/website/src/lib/schema.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personSchema,
  websiteSchema,
  bookSchema,
  publicationSchema,
  breadcrumbList,
} from './schema.mjs';

const fixtureIdentity = {
  name: 'Brigitte Le Roux',
  givenName: 'Brigitte',
  familyName: 'Le Roux',
  jobTitle: { fr: 'Chercheuse', en: 'Researcher' },
  affiliation: [{ name: 'MAP5', url: 'https://map5.example/' }],
  sameAs: ['https://orcid.org/0000-0000-0000-0000'],
};
const site = 'https://brigitte-le-roux.com';

test('personSchema emits @type Person with given/family name and sameAs', () => {
  const s = personSchema(fixtureIdentity, site, 'fr');
  assert.equal(s['@type'], 'Person');
  assert.equal(s.name, 'Brigitte Le Roux');
  assert.equal(s.givenName, 'Brigitte');
  assert.equal(s.familyName, 'Le Roux');
  assert.equal(s.jobTitle, 'Chercheuse');
  assert.deepEqual(s.sameAs, ['https://orcid.org/0000-0000-0000-0000']);
  assert.equal(s.affiliation[0]['@type'], 'Organization');
});

test('personSchema omits sameAs when empty', () => {
  const s = personSchema({ ...fixtureIdentity, sameAs: [] }, site, 'fr');
  assert.ok(!('sameAs' in s));
});

test('websiteSchema emits SearchAction template', () => {
  const s = websiteSchema(site, 'fr');
  assert.equal(s['@type'], 'WebSite');
  assert.equal(s.url, site);
  assert.equal(s.potentialAction['@type'], 'SearchAction');
});

test('bookSchema maps frontmatter book entry', () => {
  const s = bookSchema({
    slug: 'cigda',
    title: 'Combinatorial Inference in Geometric Data Analysis',
    authors: ['Le Roux, B.', 'Bienaise, S.'],
    year: 2019,
    publisher: 'Chapman & Hall/CRC',
    isbn: '9781498781619',
  });
  assert.equal(s['@type'], 'Book');
  assert.equal(s.name, 'Combinatorial Inference in Geometric Data Analysis');
  assert.deepEqual(s.author, [
    { '@type': 'Person', name: 'Le Roux, B.' },
    { '@type': 'Person', name: 'Bienaise, S.' },
  ]);
  assert.equal(s.isbn, '9781498781619');
  assert.equal(s.publisher['@type'], 'Organization');
  assert.equal(s.publisher.name, 'Chapman & Hall/CRC');
  assert.equal(s.datePublished, '2019');
});

test('publicationSchema dispatches on type', () => {
  const article = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'article',
  });
  assert.equal(article['@type'], 'ScholarlyArticle');

  const book = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'book',
  });
  assert.equal(book['@type'], 'Book');

  const chapter = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'chapter',
  });
  assert.equal(chapter['@type'], 'Chapter');

  const slides = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'slides',
  });
  assert.equal(slides['@type'], 'PresentationDigitalDocument');
});

test('publicationSchema includes pdf url when present', () => {
  const s = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['A'], venue: 'V', type: 'article',
    pdf: '/data/foo.pdf',
  });
  assert.equal(s.url, '/data/foo.pdf');
});

test('breadcrumbList builds ordered list', () => {
  const s = breadcrumbList([
    { name: 'Home', url: 'https://example.com/' },
    { name: 'Books', url: 'https://example.com/livres/' },
    { name: 'CIGDA', url: 'https://example.com/livres/cigda/' },
  ]);
  assert.equal(s['@type'], 'BreadcrumbList');
  assert.equal(s.itemListElement.length, 3);
  assert.equal(s.itemListElement[0].position, 1);
  assert.equal(s.itemListElement[2].name, 'CIGDA');
});
```

- [ ] **Step 2: Add the test:schema script to package.json**

Modify `packages/website/package.json`. Replace the `scripts` block with:

```json
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview --port 4321",
    "pull": "bash scripts/pull-public.sh",
    "deploy": "bash scripts/deploy.sh",
    "check:links": "bash scripts/check-links.sh",
    "test:schema": "node --test src/lib/schema.test.mjs"
  },
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `yarn --cwd packages/website test:schema`
Expected: FAIL with "Cannot find module './schema.mjs'" or similar.

- [ ] **Step 4: Implement the schema builders**

Create `packages/website/src/lib/schema.mjs`:

```js
// Pure JSON-LD builders. Each function returns a plain object (or array)
// suitable for embedding in <script type="application/ld+json">. Fields
// without data are omitted so partial frontmatter never produces invalid
// schema.

const CONTEXT = 'https://schema.org';

// Strips undefined / null / empty-string / empty-array properties. Schema.org
// consumers tolerate missing fields but choke on empty values.
const compact = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};

const personFromName = (name) => ({ '@type': 'Person', name });

export const personSchema = (identity, site, locale) => compact({
  '@context': CONTEXT,
  '@type': 'Person',
  name: identity.name,
  givenName: identity.givenName,
  familyName: identity.familyName,
  jobTitle: identity.jobTitle[locale] || identity.jobTitle.fr,
  url: site,
  affiliation: identity.affiliation.map(a => ({
    '@type': 'Organization',
    name: a.name,
    url: a.url,
  })),
  sameAs: identity.sameAs,
});

export const websiteSchema = (site, locale) => ({
  '@context': CONTEXT,
  '@type': 'WebSite',
  url: site,
  inLanguage: locale === 'en' ? 'en' : 'fr',
  // SearchAction is a hint to Google for the sitelinks search box. The
  // template URL points at a hypothetical /search?q= endpoint; if/when
  // an on-site search is added the URL becomes real, until then Google
  // still uses the schema for entity disambiguation.
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${site}/search?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
});

export const bookSchema = (book) => compact({
  '@context': CONTEXT,
  '@type': 'Book',
  name: book.title,
  author: book.authors.map(personFromName),
  datePublished: String(book.year),
  publisher: book.publisher ? { '@type': 'Organization', name: book.publisher } : undefined,
  isbn: book.isbn || undefined,
  url: book.external || undefined,
});

const PUBLICATION_TYPE_MAP = {
  article: 'ScholarlyArticle',
  book: 'Book',
  chapter: 'Chapter',
  slides: 'PresentationDigitalDocument',
};

export const publicationSchema = (pub) => compact({
  '@context': CONTEXT,
  '@type': PUBLICATION_TYPE_MAP[pub.type] || 'CreativeWork',
  name: pub.title,
  author: pub.authors.map(personFromName),
  datePublished: String(pub.year),
  isPartOf: pub.venue ? { '@type': 'Periodical', name: pub.venue } : undefined,
  pagination: pub.pages || undefined,
  // Prefer the local PDF over the external link — PDFs are concrete artifacts
  // Google can index; external links may be paywalled.
  url: pub.pdf || pub.external || undefined,
});

export const breadcrumbList = (items) => ({
  '@context': CONTEXT,
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: item.url,
  })),
});
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `yarn --cwd packages/website test:schema`
Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/website/src/lib/schema.mjs packages/website/src/lib/schema.test.mjs packages/website/package.json
git commit -m "feat(seo): add JSON-LD schema builders with unit tests"
```

---

## Task 3: StructuredData component

**Files:**
- Create: `packages/website/src/components/StructuredData.astro`

Single emission point so escaping and `@graph` wrapping live in one place.

- [ ] **Step 1: Create the component**

Create `packages/website/src/components/StructuredData.astro`:

```astro
---
// Emits one <script type="application/ld+json"> tag. Accepts either a single
// schema object or an array (wrapped in @graph). `set:html` is safe here:
// input is structured data we build ourselves, not user content.
const { schema } = Astro.props;
const items = Array.isArray(schema) ? schema : [schema];
const payload = items.length === 1
  ? items[0]
  : { '@context': 'https://schema.org', '@graph': items };
---
<script type="application/ld+json" set:html={JSON.stringify(payload)}></script>
```

- [ ] **Step 2: Verify the file is well-formed by running build**

Run: `yarn --cwd packages/website build`
Expected: PASS, no errors. (Component is not yet used anywhere.)

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/components/StructuredData.astro
git commit -m "feat(seo): add StructuredData component for JSON-LD emission"
```

---

## Task 4: Emit Person schema on every page (BaseLayout)

**Files:**
- Modify: `packages/website/src/layouts/BaseLayout.astro`

- [ ] **Step 1: Edit BaseLayout to import identity, schema builder, and component**

Open `packages/website/src/layouts/BaseLayout.astro`. Add these imports after the existing imports (around line 6):

```astro
import { identity } from '../lib/identity.mjs';
import { personSchema } from '../lib/schema.mjs';
import StructuredData from '../components/StructuredData.astro';
```

- [ ] **Step 2: Compute the Person schema in the frontmatter script**

Still in `BaseLayout.astro`, add this line after the existing `enUrl` constant (after line 39):

```astro
const personLd = personSchema(identity, Astro.site.href.replace(/\/$/, ''), locale);
```

- [ ] **Step 3: Render the StructuredData component inside `<head>`**

Add this line in the `<head>` block, immediately before the closing `</head>` tag (after line 76, after the Google Fonts `<link>`):

```astro
  <StructuredData schema={personLd} />
```

- [ ] **Step 4: Build and verify the script tag is emitted on a representative page**

Run:
```bash
yarn --cwd packages/website build
grep -c 'application/ld+json' packages/website/dist/index.html
```
Expected: `1` (one JSON-LD script on the FR home page).

Also run:
```bash
grep -A1 'application/ld+json' packages/website/dist/cv/index.html | head -5
```
Expected: a `<script>` tag containing `"@type":"Person","name":"Brigitte Le Roux"`.

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/layouts/BaseLayout.astro
git commit -m "feat(seo): emit Person JSON-LD on every page via BaseLayout"
```

---

## Task 5: Emit WebSite schema on the home page (HomeLayout)

**Files:**
- Modify: `packages/website/src/layouts/HomeLayout.astro`

The home page is the only place that should advertise the WebSite entity — Google uses it for the sitelinks search box and as a canonical "this site is about X" hint. Putting it everywhere would dilute the signal.

- [ ] **Step 1: Add imports to HomeLayout**

Open `packages/website/src/layouts/HomeLayout.astro`. After the existing `import BaseLayout` line (line 2):

```astro
import { websiteSchema } from '../lib/schema.mjs';
import StructuredData from '../components/StructuredData.astro';
```

- [ ] **Step 2: Compute the website schema**

After the existing `const t = data.tiles;` line (line 22), add:

```astro
const websiteLd = websiteSchema(Astro.site.href.replace(/\/$/, ''), locale);
```

- [ ] **Step 3: Render the StructuredData component inside the BaseLayout slot**

Add this line as the FIRST child of the `<BaseLayout>` block (between line 30 and line 31):

```astro
  <StructuredData schema={websiteLd} />
```

The component renders a `<script>` tag, which is valid anywhere in `<body>` — Google reads JSON-LD from anywhere in the document.

- [ ] **Step 4: Build and verify**

Run:
```bash
yarn --cwd packages/website build
grep -c 'application/ld+json' packages/website/dist/index.html
```
Expected: `2` (Person from BaseLayout + WebSite from HomeLayout).

Run:
```bash
grep 'WebSite' packages/website/dist/index.html
```
Expected: a match showing the WebSite schema in the source.

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/layouts/HomeLayout.astro
git commit -m "feat(seo): emit WebSite + SearchAction JSON-LD on home page"
```

---

## Task 6: Emit Book schemas on the books listing (BooksLayout)

**Files:**
- Modify: `packages/website/src/layouts/BooksLayout.astro`

- [ ] **Step 1: Add imports**

Open `packages/website/src/layouts/BooksLayout.astro`. After the existing `import BaseLayout` line (line 2):

```astro
import { bookSchema } from '../lib/schema.mjs';
import StructuredData from '../components/StructuredData.astro';
```

- [ ] **Step 2: Compute book schemas from the already-sorted `booksData`**

After the existing `const booksData = ...` line (line 15), add:

```astro
const bookLds = booksData.map(bookSchema);
```

- [ ] **Step 3: Render the schemas inside the BaseLayout slot**

Add this line as the FIRST child of the `<BaseLayout>` block (between line 23 and `<Content />` line 24):

```astro
  {bookLds.length > 0 && <StructuredData schema={bookLds} />}
```

The component wraps multiple schemas in `@graph` automatically.

- [ ] **Step 4: Build and verify**

Run:
```bash
yarn --cwd packages/website build
grep '"@type":"Book"' packages/website/dist/livres/index.html | head -1
```
Expected: a match showing at least one Book entity in the FR books-listing page source.

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/layouts/BooksLayout.astro
git commit -m "feat(seo): emit Book JSON-LD per entry on the books listing"
```

---

## Task 7: Emit Publication schemas on the publications listing (PublicationsLayout)

**Files:**
- Modify: `packages/website/src/layouts/PublicationsLayout.astro`

- [ ] **Step 1: Add imports**

Open `packages/website/src/layouts/PublicationsLayout.astro`. After the existing `import BaseLayout` line (line 2):

```astro
import { publicationSchema } from '../lib/schema.mjs';
import StructuredData from '../components/StructuredData.astro';
```

- [ ] **Step 2: Compute the publication schemas**

After the existing `const publicationsData = ...` line (line 15), add:

```astro
const publicationLds = publicationsData.map(publicationSchema);
```

- [ ] **Step 3: Render inside BaseLayout slot**

Add this line as the FIRST child of the `<BaseLayout>` block (between line 30 and `<Content />` line 31):

```astro
  {publicationLds.length > 0 && <StructuredData schema={publicationLds} />}
```

- [ ] **Step 4: Build and verify**

Run:
```bash
yarn --cwd packages/website build
grep -c '"@type":"ScholarlyArticle"' packages/website/dist/publications/index.html
```
Expected: a number ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add packages/website/src/layouts/PublicationsLayout.astro
git commit -m "feat(seo): emit ScholarlyArticle / Book / Chapter JSON-LD on publications listing"
```

---

## Task 8: Emit BreadcrumbList on detail pages (PageLayout)

**Files:**
- Modify: `packages/website/src/layouts/PageLayout.astro`

PageLayout currently serves both narrative pages (`/cv/`, `/recherches/`, …) and detail pages (`/livres/cigda/`). BreadcrumbList only makes sense on detail pages — the discriminator is whether the URL has a parent segment.

- [ ] **Step 1: Replace the contents of PageLayout.astro**

Open `packages/website/src/layouts/PageLayout.astro`. Replace the entire file with:

```astro
---
import BaseLayout from './BaseLayout.astro';
import { breadcrumbList } from '../lib/schema.mjs';
import StructuredData from '../components/StructuredData.astro';
import frStrings from '../../content/i18n/fr.json';
import enStrings from '../../content/i18n/en.json';

const { title, locale, description, keywords } = Astro.props;

// Detect detail pages: paths with two or more non-empty segments after the
// locale prefix. /livres/cigda/ → detail; /cv/ → narrative.
const baseUrl = import.meta.env.BASE_URL;
const stripped = Astro.url.pathname
  .replace(new RegExp(`^${baseUrl}`), '')
  .replace(/^en\//, '')
  .replace(/\/$/, '');
const segments = stripped.split('/').filter(Boolean);
const isDetail = segments.length >= 2;

// For the breadcrumb, the parent listing's label comes from i18n (e.g. "Livres" /
// "Books"). nav[<parent-slug>] keeps the label in lockstep with the header nav.
const strings = locale === 'en' ? enStrings : frStrings;
const parentSlug = isDetail ? segments[0] : null;
const parentLabel = parentSlug && strings.nav?.[parentSlug];

const siteOrigin = Astro.site.href.replace(/\/$/, '');
const localePrefix = locale === 'en' ? '/en' : '';

const breadcrumbLd = isDetail && parentLabel ? breadcrumbList([
  { name: strings.nav.home, url: `${siteOrigin}${localePrefix}/` },
  { name: parentLabel, url: `${siteOrigin}${localePrefix}/${parentSlug}/` },
  { name: title, url: `${siteOrigin}${localePrefix}/${stripped}/` },
]) : null;
---

<BaseLayout title={title} locale={locale} description={description} keywords={keywords}>
  {breadcrumbLd && <StructuredData schema={breadcrumbLd} />}
  <article>
    <h1>{title}</h1>
    <slot />
  </article>
</BaseLayout>
```

- [ ] **Step 2: Build and verify**

Run:
```bash
yarn --cwd packages/website build
ls packages/website/dist/livres/
```
Find a detail page (e.g. `cigda/`) and check:

```bash
grep '"@type":"BreadcrumbList"' packages/website/dist/livres/cigda/index.html
```
Expected: one match.

Also verify a top-level narrative page (e.g. `/cv/`) does NOT have a breadcrumb:

```bash
grep -c '"@type":"BreadcrumbList"' packages/website/dist/cv/index.html
```
Expected: `0`.

- [ ] **Step 3: Commit**

```bash
git add packages/website/src/layouts/PageLayout.astro
git commit -m "feat(seo): emit BreadcrumbList JSON-LD on detail pages"
```

---

## Task 9: Self-host fonts; remove Google Fonts links

**Files:**
- Create: `packages/website/public/fonts/fraunces-variable.woff2`
- Create: `packages/website/public/fonts/bricolage-grotesque-variable.woff2`
- Modify: `packages/website/src/styles/theme.css` (add @font-face declarations)
- Modify: `packages/website/src/layouts/BaseLayout.astro` (preload + remove Google Fonts links)

Both fonts are SIL OFL, self-hosting permitted. We use the variable WOFF2 build (one file per family covers all axes/weights).

- [ ] **Step 1: Create the fonts directory and download the WOFF2 files**

The cleanest source for self-hosted Google Fonts is https://gwfh.mranftl.com/fonts (a community packager that bundles the Google Fonts WOFF2 files). Open the site, search for each family, choose "Modern Browsers" → Latin subset → check the variable-axis option, and download the ZIP.

For each family, extract the `.woff2` file with `wght` (and `opsz` if available) variable axes and place it at the path below. Rename if the downloaded filename doesn't match exactly.

```bash
mkdir -p packages/website/public/fonts
# After download:
#   packages/website/public/fonts/fraunces-variable.woff2
#   packages/website/public/fonts/bricolage-grotesque-variable.woff2
ls packages/website/public/fonts/
```
Expected: both files present, each typically 50–200 KB.

If gwfh.mranftl.com doesn't expose the variable axis, fall back to downloading from the upstream font project repos:
- Fraunces: https://github.com/undercasetype/Fraunces (look under `fonts/variable/`)
- Bricolage Grotesque: https://github.com/ateliertriay/bricolage (look under `fonts/`)

- [ ] **Step 2: Add @font-face declarations to theme.css**

Open `packages/website/src/styles/theme.css`. At the very top (line 1, before the existing comment block), insert:

```css
/* Self-hosted variable fonts. `font-display: swap` shows fallback Georgia / sans-serif
   immediately while WOFF2 loads, avoiding invisible-text FOIT. The `unicode-range` is
   the Latin subset — covers FR + EN content. */
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/fraunces-variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/fraunces-variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: 'Bricolage Grotesque';
  src: url('/fonts/bricolage-grotesque-variable.woff2') format('woff2-variations');
  font-weight: 200 800;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 3: Remove Google Fonts links and add preload tags in BaseLayout**

Open `packages/website/src/layouts/BaseLayout.astro`. Replace the three Google Fonts lines (lines 74–76):

```astro
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,700&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700&display=swap" rel="stylesheet" />
```

With:

```astro
  <link rel="preload" href="/fonts/fraunces-variable.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/fonts/bricolage-grotesque-variable.woff2" as="font" type="font/woff2" crossorigin />
```

- [ ] **Step 4: Build and visually verify fonts still render correctly**

Run:
```bash
yarn --cwd packages/website build
yarn --cwd packages/website preview
```
Open http://localhost:4321 in a browser. Expected: same typography as before — Fraunces serif on body/headlines, Bricolage Grotesque on nav/kicker.

In DevTools Network tab: confirm zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`; instead two requests to `/fonts/*.woff2` from your own origin.

If the fonts look wrong (e.g. falling back to Georgia), the WOFF2 file likely lacks the variable axis or has the wrong family-name metadata — re-download from the alternate source.

- [ ] **Step 5: Commit**

```bash
git add packages/website/public/fonts packages/website/src/styles/theme.css packages/website/src/layouts/BaseLayout.astro
git commit -m "perf(seo): self-host Fraunces and Bricolage Grotesque WOFF2 fonts"
```

Note: this commit may include `public/fonts/*.woff2` despite `.gitignore` covering `public/`. The carve-out pattern in `.gitignore` should already permit `public/cms/**`; if `public/fonts/**` is blocked, add a similar negation rule:

```
!packages/website/public/fonts/
!packages/website/public/fonts/**
```

Verify with `git status` before commit that the WOFF2 files appear in the staged changes.

---

## Task 10: Conditional Google Search Console verification meta

**Files:**
- Modify: `packages/website/src/layouts/BaseLayout.astro`

Per the spec, the verification value is supplied by Search Console after the property is added. Until that value is known, the meta tag is omitted entirely (no placeholder string). We add a single constant and a conditional emit.

- [ ] **Step 1: Add the verification constant**

Open `packages/website/src/layouts/BaseLayout.astro`. Add this constant in the frontmatter script, immediately after the existing `const enUrl` line (around line 39):

```astro
// Set this to the value Google Search Console issues after adding the
// property at https://search.google.com/search-console. Leave null until
// then — the meta tag is then omitted entirely (no placeholder ships).
const googleSiteVerification = null;
```

- [ ] **Step 2: Emit the meta tag conditionally**

In the `<head>` block, add this line immediately after the existing `<link rel="canonical">` tag (after line 51):

```astro
  {googleSiteVerification && <meta name="google-site-verification" content={googleSiteVerification} />}
```

- [ ] **Step 3: Build and verify the meta is NOT yet emitted**

Run:
```bash
yarn --cwd packages/website build
grep -c 'google-site-verification' packages/website/dist/index.html
```
Expected: `0` (constant is null so the tag is suppressed).

- [ ] **Step 4: Commit**

```bash
git add packages/website/src/layouts/BaseLayout.astro
git commit -m "feat(seo): conditional Google Search Console verification meta"
```

---

## Task 11: Per-page meta descriptions and keywords (6 pages × 2 locales)

**Files:**
- Modify (12 files):
  - `packages/website/content/pages/home.fr.md`
  - `packages/website/content/pages/home.en.md`
  - `packages/website/content/pages/recherches.fr.md`
  - `packages/website/content/pages/recherches.en.md`
  - `packages/website/content/pages/livres.fr.md`
  - `packages/website/content/pages/livres.en.md`
  - `packages/website/content/pages/publications.fr.md`
  - `packages/website/content/pages/publications.en.md`
  - `packages/website/content/pages/these.fr.md`
  - `packages/website/content/pages/these.en.md`
  - `packages/website/content/pages/logiciels.fr.md`
  - `packages/website/content/pages/logiciels.en.md`

These are starter drafts written to match the keyword focus from the spec table. Brigitte (the editor) is expected to polish them after deploy; do not block the implementation on her review. Length targets ~155 characters for `description`.

**Placement convention for all 12 edits:** the two new lines (`description:` and `keywords:`) go at the **top level** of the YAML frontmatter (i.e. inside the `---` … `---` block, at the same indentation as the existing `title:` / `locale:` / `slug:` keys — NOT nested inside `portrait:`, `tiles:`, or any other object). YAML key order at the top level is irrelevant; the conventional spot is immediately after `slug:`.

- [ ] **Step 1: home.fr.md — add description and keywords**

In the top-level YAML frontmatter (immediately after the existing `slug:` line), insert:

```yaml
description: "Brigitte Le Roux, chercheuse en analyse géométrique des données (AGD) et analyse des correspondances multiples (ACM), MAP5 Université Paris Cité et CEVIPOF/CNRS."
keywords: "Brigitte Le Roux, analyse géométrique des données, AGD, analyse des correspondances multiples, ACM, MAP5, CEVIPOF, Université Paris Cité"
```

- [ ] **Step 2: home.en.md — add description and keywords**

```yaml
description: "Brigitte Le Roux, researcher in Geometric Data Analysis (GDA) and Multiple Correspondence Analysis (MCA), MAP5 Université Paris Cité and CEVIPOF/CNRS."
keywords: "Brigitte Le Roux, Geometric Data Analysis, GDA, Multiple Correspondence Analysis, MCA, MAP5, CEVIPOF, Université Paris Cité"
```

- [ ] **Step 3: recherches.fr.md — add description and keywords**

```yaml
description: "Recherches en analyse géométrique des données : analyse des correspondances multiples, sociologie quantitative, études de cas, espaces sociaux."
keywords: "analyse géométrique des données, AGD, ACM, sociologie quantitative, statistique appliquée, espace social, Bourdieu, études de cas"
```

- [ ] **Step 4: recherches.en.md — add description and keywords**

```yaml
description: "Research in Geometric Data Analysis: Multiple Correspondence Analysis, quantitative sociology, case studies, social spaces."
keywords: "Geometric Data Analysis, GDA, MCA, Multiple Correspondence Analysis, quantitative sociology, applied statistics, Bourdieu, social space, case studies"
```

- [ ] **Step 5: livres.fr.md — add description and keywords**

```yaml
description: "Livres de Brigitte Le Roux sur l'analyse géométrique des données : Combinatorial Inference in GDA (Chapman & Hall/CRC), Geometric Data Analysis, ouvrages traduits."
keywords: "Brigitte Le Roux livres, Combinatorial Inference in Geometric Data Analysis, CIGDA, Geometric Data Analysis, GDA, Chapman & Hall, analyse géométrique des données"
```

- [ ] **Step 6: livres.en.md — add description and keywords**

```yaml
description: "Books by Brigitte Le Roux on Geometric Data Analysis: Combinatorial Inference in GDA (Chapman & Hall/CRC), Geometric Data Analysis, translated works."
keywords: "Brigitte Le Roux books, Combinatorial Inference in Geometric Data Analysis, CIGDA, Geometric Data Analysis, GDA, Chapman & Hall, MCA"
```

- [ ] **Step 7: publications.fr.md — add description and keywords**

```yaml
description: "Publications scientifiques de Brigitte Le Roux : articles, rapports techniques et communications en analyse géométrique des données et sociologie quantitative."
keywords: "publications Brigitte Le Roux, ACM, AGD, Lebaron, Bonnet, Rouanet, Bourdieu, champ, sociologie quantitative, articles scientifiques"
```

- [ ] **Step 8: publications.en.md — add description and keywords**

```yaml
description: "Scientific publications of Brigitte Le Roux: articles, technical reports and presentations in Geometric Data Analysis and quantitative sociology."
keywords: "Brigitte Le Roux publications, MCA, GDA, Lebaron, Bonnet, Rouanet, Bourdieu, field, quantitative sociology, scientific articles"
```

- [ ] **Step 9: these.fr.md — add description and keywords**

```yaml
description: "Thèse de doctorat et HDR de Brigitte Le Roux en analyse géométrique des données (AGD), MAP5 Université Paris Cité."
keywords: "Brigitte Le Roux thèse, HDR, doctorat, analyse géométrique des données, AGD, MAP5, Université Paris Cité"
```

- [ ] **Step 10: these.en.md — add description and keywords**

```yaml
description: "Doctoral thesis and HDR of Brigitte Le Roux in Geometric Data Analysis (GDA), MAP5 Université Paris Cité."
keywords: "Brigitte Le Roux thesis, HDR, doctorate, Geometric Data Analysis, GDA, MAP5, Université Paris Cité"
```

- [ ] **Step 11: logiciels.fr.md — add description and keywords**

```yaml
description: "Logiciels et fichiers de données pour l'analyse géométrique des données : Eyelid, ADDAD et jeux de données téléchargeables."
keywords: "logiciels analyse géométrique des données, Eyelid, ADDAD, AGD, ACM, fichiers de données, datasets, statistique"
```

- [ ] **Step 12: logiciels.en.md — add description and keywords**

```yaml
description: "Software and datasets for Geometric Data Analysis: Eyelid, ADDAD, and downloadable data files."
keywords: "Geometric Data Analysis software, Eyelid, ADDAD, GDA, MCA, datasets, data files, statistics"
```

- [ ] **Step 13: Build and verify the meta tags emit**

Run:
```bash
yarn --cwd packages/website build
grep '<meta name="description"' packages/website/dist/recherches/index.html
```
Expected: a `<meta name="description">` whose content matches the FR `recherches` snippet.

Spot-check one EN page:

```bash
grep '<meta name="description"' packages/website/dist/en/livres/index.html
```
Expected: matches the EN `livres` snippet.

- [ ] **Step 14: Commit**

```bash
git add packages/website/content/pages/{home,recherches,livres,publications,these,logiciels}.{fr,en}.md
git commit -m "feat(seo): add per-page meta descriptions and keywords on 6 priority pages"
```

---

## Task 12: Update CLAUDE.md with SEO/identity documentation

**Files:**
- Modify: `CLAUDE.md`

Future contributors need to know where identity facts live and how JSON-LD is wired. The existing CLAUDE.md has a `## SEO` section — extend it.

- [ ] **Step 1: Extend the SEO section in CLAUDE.md**

Open `CLAUDE.md`. Find the existing `## SEO` section. Immediately before the next top-level `##` heading after `## SEO` (the `## Build & deploy` section), append:

```markdown

### JSON-LD structured data

Identity facts (name, affiliations, ORCID/Scholar/ResearchGate URLs) live in
**one** locale-agnostic file: `packages/website/content/identity.json`. The
schema for that file is enforced at module-load time by
`packages/website/src/lib/identity.mjs` (Zod). To update Brigitte's external
identity links, edit `identity.json` and rebuild — no code change.

JSON-LD payloads are built by pure functions in
`packages/website/src/lib/schema.mjs` (`personSchema`, `websiteSchema`,
`bookSchema`, `publicationSchema`, `breadcrumbList`) and emitted by a single
component, `packages/website/src/components/StructuredData.astro`, which
wraps a `<script type="application/ld+json">` tag.

Where each schema is injected:

- `BaseLayout.astro` → `Person` on every page.
- `HomeLayout.astro` → `WebSite` + `SearchAction` on the home page.
- `BooksLayout.astro` → one `Book` per `books:` entry, wrapped in `@graph`.
- `PublicationsLayout.astro` → one `ScholarlyArticle` / `Book` / `Chapter` /
  `PresentationDigitalDocument` per `publications:` entry (dispatched on
  `type`), wrapped in `@graph`.
- `PageLayout.astro` → `BreadcrumbList` on detail pages only (paths with
  ≥ 2 segments, e.g. `/livres/cigda/`).

To add a new schema type: write a builder in `schema.mjs`, add a test in
`schema.test.mjs`, run `yarn --cwd packages/website test:schema`, and import
it in the layout that owns it.

### Google Search Console

`BaseLayout.astro` carries a `googleSiteVerification` constant. When the site
is registered with Search Console, set this constant to the value Google
issues; the verification `<meta>` tag is then emitted on every page. Leave
null until you have a real value — no placeholder ships.

### Self-hosted fonts

Fraunces and Bricolage Grotesque are SIL OFL variable fonts served from
`packages/website/public/fonts/*.woff2`. `@font-face` declarations live at
the top of `packages/website/src/styles/theme.css`. To update a font, drop
in a new WOFF2 of the same name and rebuild — no other change required.

```

- [ ] **Step 2: Verify the section is well-formed**

Open `CLAUDE.md` and visually confirm the inserted block sits between the
existing `## SEO` content and the next `##` section, with no broken markdown.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document JSON-LD identity, schema layout, and font self-hosting"
```

---

## Task 13: Final verification

**Files:** none.

- [ ] **Step 1: Run full build and confirm clean**

Run: `yarn --cwd packages/website build`
Expected: PASS with no warnings about schema/identity validation. Check the build summary lists all expected pages.

- [ ] **Step 2: Run schema unit tests**

Run: `yarn --cwd packages/website test:schema`
Expected: All tests PASS.

- [ ] **Step 3: View-source spot checks on built HTML**

```bash
# Home: Person + WebSite
grep -c 'application/ld+json' packages/website/dist/index.html              # expect 2
# Books listing: Person + Book[]
grep -c 'application/ld+json' packages/website/dist/livres/index.html       # expect 2
# Publications listing: Person + ScholarlyArticle[]
grep -c 'application/ld+json' packages/website/dist/publications/index.html # expect 2
# Book detail: Person + BreadcrumbList
grep -c 'application/ld+json' packages/website/dist/livres/cigda/index.html # expect 2
# Narrative page: Person only
grep -c 'application/ld+json' packages/website/dist/cv/index.html           # expect 1
```

- [ ] **Step 4: Run dev server and check live HTML**

Run: `yarn --cwd packages/website dev`
Open http://localhost:4321 in a browser. Right-click → View page source.
- Confirm exactly two `<script type="application/ld+json">` tags.
- Confirm `<link rel="preload">` tags for both WOFF2 files.
- Confirm NO `<link>` to `fonts.googleapis.com` or `fonts.gstatic.com`.
- Confirm `<meta name="description">` matches the FR home snippet.

In DevTools Network tab: filter to "Font". Confirm only same-origin font requests; no Google Fonts requests.

- [ ] **Step 5: Manual post-deploy validation (after `yarn frontend:deploy`)**

These are out-of-band steps but listed here as the acceptance gate:

1. https://search.google.com/test/rich-results — paste `https://brigitte-le-roux.com/`. Expect "Page is eligible for rich results" with `Person` and `WebSite` detected.
2. Same tool on `https://brigitte-le-roux.com/livres/`. Expect `Person` + multiple `Book` items.
3. Same tool on `https://brigitte-le-roux.com/livres/cigda/`. Expect `Person` + `BreadcrumbList`.
4. https://validator.schema.org — second-opinion validation on the same three URLs.
5. https://pagespeed.web.dev/ on `https://brigitte-le-roux.com/`. Confirm "Eliminate render-blocking resources" warning is gone or reduced (font requests now self-origin and preloaded).
6. Google Search Console → add property for `brigitte-le-roux.com` (DNS or HTML-tag verification). After verification, update `googleSiteVerification` constant in BaseLayout and redeploy.

- [ ] **Step 6: Final commit (if any housekeeping changes)**

If steps 1–5 surfaced no issues, no further commits. If any tweaks were needed, commit them with a `fix(seo):` prefix.

---

## Out of plan (deferred / editorial)

- **Editor polish on the 12 meta descriptions** — Brigitte may want to reword. The plan ships starter drafts; she can edit through Sveltia CMS or direct markdown.
- **Populating `identity.json` `sameAs`** — needs Brigitte's ORCID iD, Scholar profile URL, ResearchGate URL, MAP5/CEVIPOF page URLs. Edit `content/identity.json` and redeploy.
- **Search Console property registration + meta value** — operational, not code.
- **Long-term ranking observation** — 4–12 weeks via Search Console, per spec.
