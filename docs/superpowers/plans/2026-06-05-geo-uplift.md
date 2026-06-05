# GEO uplift (markup-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make brigitte-le-roux.com a well-understood, citable entity for AI answer engines — via explicit AI-crawler welcome, a generated `/llms.txt`, a hardened `Person` JSON-LD node, and an `@id`-linked entity graph — with zero human-visible change.

**Architecture:** Pure additive markup. JSON-LD builders in `src/lib/schema.mjs` gain a stable Person `@id`, richer Person fields, and author→entity `@id` linking; identity facts grow in `content/identity.json` (validated in `src/lib/identity.mjs`); two build-time endpoints (`robots.txt.js`, new `llms.txt.js`) emit the crawler policy and the site map for LLMs. Nothing rendered to human visitors changes.

**Tech Stack:** Astro 5 (static output), Node test runner (`node --test`), Zod (via `astro:content`), Yarn.

> **Commit policy:** This project's rule is **never commit automatically**. Each "Commit" step lists the staged files and the message; the **user runs the commit** (or explicitly approves). Do not run `git commit` without the user's go-ahead.

> **Spec note:** The spec (`docs/superpowers/specs/2026-06-05-geo-uplift-design.md`) named `src/content/config.mjs` for the identity Zod schema; the schema actually lives in `src/lib/identity.mjs`. The spec also left author-matching as an open question — this plan resolves it to the codebase's existing `startsWith('Le Roux')` convention (author strings are `"Le Roux, B."`, not the full identity name), and derives the Person `@id` inside `personSchema`/`websiteSchema` so `BaseLayout`/`HomeLayout` are untouched.

---

### Task 1: Person entity hardening — identity data + validation

Add machine-only `description` and `knowsAbout` to the identity source and its Zod validator. No rendered change; the build must still pass (the schema validates at module load).

**Files:**
- Modify: `packages/website/content/identity.json`
- Modify: `packages/website/src/lib/identity.mjs:7-17`

- [ ] **Step 1: Add `description` and `knowsAbout` to `identity.json`**

Replace the whole file with (keeps existing fields, appends two new keys):

```json
{
  "name": "Brigitte Le Roux",
  "givenName": "Brigitte",
  "familyName": "Le Roux",
  "jobTitle": {
    "fr": "Chercheuse en analyse géométrique des données",
    "en": "Researcher in Geometric Data Analysis"
  },
  "description": {
    "fr": "Brigitte Le Roux est chercheuse en analyse géométrique des données, affiliée au laboratoire MAP5 (Université Paris Cité) et au CEVIPOF (CNRS / Sciences Po). Ses travaux développent l'analyse des correspondances multiples et son application en sociologie quantitative, dans le prolongement de l'analyse des données de Jean-Paul Benzécri et de la sociologie de Pierre Bourdieu.",
    "en": "Brigitte Le Roux is a researcher in Geometric Data Analysis, affiliated with the MAP5 laboratory (Université Paris Cité) and CEVIPOF (CNRS / Sciences Po). Her work develops Multiple Correspondence Analysis and its application to quantitative sociology, building on Jean-Paul Benzécri's data analysis and Pierre Bourdieu's sociology."
  },
  "knowsAbout": {
    "fr": [
      "Analyse géométrique des données",
      "Analyse des correspondances multiples",
      "Statistique",
      "Sociologie quantitative",
      "Théorie des champs de Pierre Bourdieu"
    ],
    "en": [
      "Geometric Data Analysis",
      "Multiple Correspondence Analysis",
      "Statistics",
      "Quantitative sociology",
      "Pierre Bourdieu's field theory"
    ]
  },
  "affiliation": [
    { "name": "MAP5, Université Paris Cité", "url": "https://map5.mi.parisdescartes.fr/" },
    { "name": "CEVIPOF, CNRS / Sciences Po", "url": "https://www.sciencespo.fr/cevipof/" }
  ],
  "sameAs": [
    "https://orcid.org/0009-0009-1207-0958",
    "https://scholar.google.com/citations?user=-MqjcKQAAAAJ",
    "https://www.researchgate.net/profile/Brigitte-Le-Roux",
    "https://www.sciencespo.fr/cevipof/fr/annuaire/leroux-brigitte/"
  ]
}
```

> The FR/EN bio sentences are a usable factual draft — flag them to the editor for a final wording pass, but they ship valid as-is.

- [ ] **Step 2: Extend the Zod schema in `identity.mjs`**

In `packages/website/src/lib/identity.mjs`, change the `schema` object (lines 7-17) to add the two optional fields:

```js
const schema = z.object({
  name: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  jobTitle: z.object({ fr: z.string(), en: z.string() }),
  // Optional, machine-only (GEO): a one-paragraph bio and expertise tags,
  // surfaced in the Person JSON-LD. Optional so identity.json stays valid
  // if a future edit drops them.
  description: z.object({ fr: z.string(), en: z.string() }).optional(),
  knowsAbout: z.object({ fr: z.array(z.string()), en: z.array(z.string()) }).optional(),
  affiliation: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
  })),
  sameAs: z.array(z.string().url()),
});
```

- [ ] **Step 3: Verify the build still parses identity.json**

Run: `yarn frontend:build`
Expected: build completes with no Zod parse error (a malformed identity would throw at module load).

- [ ] **Step 4: Commit** *(user runs)*

```bash
git add packages/website/content/identity.json packages/website/src/lib/identity.mjs
git commit -m "feat(geo): add description and knowsAbout to identity"
```

---

### Task 2: `personId` helper + Person `@id`/`description`/`knowsAbout`

TDD. Give the Person node a stable `@id` (the anchor the whole entity graph references) and surface the new identity fields.

**Files:**
- Modify: `packages/website/src/lib/schema.mjs:21-37`
- Test: `packages/website/src/lib/schema.test.mjs`

- [ ] **Step 1: Write failing tests**

In `packages/website/src/lib/schema.test.mjs`, add `personId` to the import block (lines 3-9):

```js
import {
  personId,
  personSchema,
  websiteSchema,
  bookSchema,
  publicationSchema,
  breadcrumbList,
} from './schema.mjs';
```

Then append these tests at the end of the file:

```js
test('personId derives a #person anchor from site', () => {
  assert.equal(personId(site), 'https://brigitte-le-roux.com#person');
});

test('personSchema includes a stable @id derived from site', () => {
  const s = personSchema(fixtureIdentity, site, 'fr');
  assert.equal(s['@id'], 'https://brigitte-le-roux.com#person');
});

test('personSchema includes locale description and knowsAbout when present', () => {
  const id = {
    ...fixtureIdentity,
    description: { fr: 'desc-fr', en: 'desc-en' },
    knowsAbout: { fr: ['A', 'B'], en: ['X', 'Y'] },
  };
  const fr = personSchema(id, site, 'fr');
  assert.equal(fr.description, 'desc-fr');
  assert.deepEqual(fr.knowsAbout, ['A', 'B']);
  const en = personSchema(id, site, 'en');
  assert.equal(en.description, 'desc-en');
  assert.deepEqual(en.knowsAbout, ['X', 'Y']);
});

test('personSchema omits description and knowsAbout when absent', () => {
  const s = personSchema(fixtureIdentity, site, 'fr');
  assert.ok(!('description' in s));
  assert.ok(!('knowsAbout' in s));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn --cwd packages/website test:schema`
Expected: FAIL — `personId` is not exported (import error) / `@id` undefined.

- [ ] **Step 3: Implement in `schema.mjs`**

In `packages/website/src/lib/schema.mjs`, add the `personId` helper just above `personFromName` (after line 19), and rewrite `personSchema`:

```js
// Stable canonical identifier for the Person entity. Every authored work and
// the WebSite node reference this @id so consumers merge them into one entity
// graph — even across separate <script type="application/ld+json"> tags.
export const personId = (site) => `${site}#person`;

const personFromName = (name) => ({ '@type': 'Person', name });

export const personSchema = (identity, site, locale) => compact({
  '@context': CONTEXT,
  '@type': 'Person',
  '@id': personId(site),
  name: identity.name,
  givenName: identity.givenName,
  familyName: identity.familyName,
  jobTitle: identity.jobTitle[locale] || identity.jobTitle.fr,
  // Optional GEO fields — compact() drops them when identity omits them.
  description: identity.description?.[locale] || identity.description?.fr,
  knowsAbout: identity.knowsAbout?.[locale] || identity.knowsAbout?.fr,
  url: site,
  affiliation: identity.affiliation.map(a => ({
    '@type': 'Organization',
    name: a.name,
    url: a.url,
  })),
  sameAs: identity.sameAs,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn --cwd packages/website test:schema`
Expected: PASS (all tests, including the four new ones).

- [ ] **Step 5: Commit** *(user runs)*

```bash
git add packages/website/src/lib/schema.mjs packages/website/src/lib/schema.test.mjs
git commit -m "feat(geo): add stable Person @id, description and knowsAbout to personSchema"
```

---

### Task 3: Entity-graph `@id` linking (books, publications, website)

TDD. Link Brigitte's authored works and the WebSite node to her Person `@id`. This is the highest-leverage GEO change — it turns a flat list of works with anonymous authors into a connected entity graph.

**Files:**
- Modify: `packages/website/src/lib/schema.mjs:39-67` (websiteSchema, bookSchema)
- Modify: `packages/website/src/lib/schema.mjs:88-99` (publicationSchema)
- Test: `packages/website/src/lib/schema.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `packages/website/src/lib/schema.test.mjs`:

```js
test('bookSchema links a Le Roux author to the Person @id when personId given', () => {
  const s = bookSchema({
    slug: 'cigda', title: 'T', authors: ['Le Roux, B.', 'Bienaise, S.'],
    year: 2019, publisher: 'P',
  }, personId(site));
  assert.deepEqual(s.author[0], { '@id': 'https://brigitte-le-roux.com#person' });
  assert.deepEqual(s.author[1], { '@type': 'Person', name: 'Bienaise, S.' });
});

test('bookSchema keeps anonymous authors when no personId passed', () => {
  const s = bookSchema({
    slug: 'x', title: 'T', authors: ['Le Roux, B.'], year: 2019, publisher: 'P',
  });
  assert.deepEqual(s.author[0], { '@type': 'Person', name: 'Le Roux, B.' });
});

test('publicationSchema links a Le Roux author to the Person @id', () => {
  const s = publicationSchema({
    slug: 'x', year: 2013, title: 'T', authors: ['Lebaron, F.', 'Le Roux, B.'],
    venue: 'V', type: 'article',
  }, personId(site));
  assert.deepEqual(s.author[0], { '@type': 'Person', name: 'Lebaron, F.' });
  assert.deepEqual(s.author[1], { '@id': 'https://brigitte-le-roux.com#person' });
});

test('websiteSchema references the Person @id as author and about', () => {
  const s = websiteSchema(site, 'fr');
  assert.deepEqual(s.author, { '@id': 'https://brigitte-le-roux.com#person' });
  assert.deepEqual(s.about, { '@id': 'https://brigitte-le-roux.com#person' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn --cwd packages/website test:schema`
Expected: FAIL — `author[0]` is still `{ '@type': 'Person', name: 'Le Roux, B.' }`; `websiteSchema` has no `author`/`about`.

- [ ] **Step 3: Implement in `schema.mjs`**

Add an `authorNode` helper just below `personFromName`:

```js
// Link an author to the Person entity when it is Brigitte. Author strings on
// this site are formatted "Le Roux, B." (not the full identity name), so we use
// the same startsWith('Le Roux') rule the listing layouts already apply. Other
// authors stay anonymous Person objects — we have no stable IDs for co-authors.
const authorNode = (name, pid) =>
  pid && name.startsWith('Le Roux') ? { '@id': pid } : personFromName(name);
```

Add `author`/`about` to `websiteSchema` (it must reference the same `@id`):

```js
export const websiteSchema = (site, locale) => ({
  '@context': CONTEXT,
  '@type': 'WebSite',
  url: site,
  inLanguage: locale === 'en' ? 'en' : 'fr',
  // Declare the site's subject and owner as the Person entity.
  author: { '@id': personId(site) },
  about: { '@id': personId(site) },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${site}/search?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
});
```

Change `bookSchema`'s signature and `author` mapping:

```js
export const bookSchema = (book, personId) => compact({
  '@context': CONTEXT,
  '@type': 'Book',
  name: book.title,
  author: book.authors.map((name) => authorNode(name, personId)),
  datePublished: String(book.year),
  publisher: book.publisher ? { '@type': 'Organization', name: book.publisher } : undefined,
  isbn: book.isbn || undefined,
  url: book.external || undefined,
});
```

Change `publicationSchema`'s signature and `author` mapping:

```js
export const publicationSchema = (pub, personId) => compact({
  '@context': CONTEXT,
  '@type': PUBLICATION_TYPE_MAP[pub.type] || 'CreativeWork',
  name: pub.title,
  author: pub.authors.map((name) => authorNode(name, personId)),
  datePublished: String(pub.year),
  isPartOf: pub.venue ? { '@type': VENUE_TYPE_MAP[pub.type] || 'CreativeWork', name: pub.venue } : undefined,
  pagination: pub.pages || undefined,
  url: pub.pdf || pub.external || undefined,
});
```

> Note: the `personId` parameter name shadows the exported `personId` helper inside these two builders — intentional and harmless (they receive the resolved id string, they don't call the helper). `websiteSchema` and `personSchema` call the helper directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn --cwd packages/website test:schema`
Expected: PASS (all tests). The existing `bookSchema maps frontmatter book entry` test passes a book with NO `personId` arg, so its author array stays anonymous — unchanged.

- [ ] **Step 5: Commit** *(user runs)*

```bash
git add packages/website/src/lib/schema.mjs packages/website/src/lib/schema.test.mjs
git commit -m "feat(geo): link authored works and WebSite to Person @id"
```

---

### Task 4: Wire `personId` through the listing layouts

The builders now accept a `personId`; pass it from the two layouts that emit Book/Publication JSON-LD. `BaseLayout` (Person) and `HomeLayout` (WebSite) need no change — they derive the `@id` internally.

**Files:**
- Modify: `packages/website/src/layouts/BooksLayout.astro:3,17-20`
- Modify: `packages/website/src/layouts/PublicationsLayout.astro:3,17-18`

- [ ] **Step 1: Update `BooksLayout.astro`**

Change the import on line 3:

```js
import { bookSchema, personId } from '../lib/schema.mjs';
```

Replace the `bookLds` derivation (lines 17-20) with:

```js
const booksData = (data.books ?? []).slice().sort((a, b) => b.year - a.year);

// Trailing-slash-stripped site origin matches the personSchema/@id convention.
const pid = personId(Astro.site.href.replace(/\/$/, ''));

// Emit one Book JSON-LD per entry; Le Roux authorship links to the Person @id.
const bookLds = booksData.map(b => bookSchema(b, pid));
```

- [ ] **Step 2: Update `PublicationsLayout.astro`**

Change the import on line 3:

```js
import { publicationSchema, personId } from '../lib/schema.mjs';
```

Replace lines 17-18 with:

```js
const publicationsData = (data.publications ?? []).slice().sort((a, b) => b.year - a.year);
const pid = personId(Astro.site.href.replace(/\/$/, ''));
const publicationLds = publicationsData.map(p => publicationSchema(p, pid));
```

- [ ] **Step 3: Build and verify the linked `@id` is emitted**

Run: `yarn frontend:build`
Then: `grep -o '"@id":"https://brigitte-le-roux.com#person"' packages/website/dist/livres/index.html | head`
Expected: at least one match (CIGDA / GDA author entries now reference the Person `@id`).

Also: `grep -o '"@id":"https://brigitte-le-roux.com#person"' packages/website/dist/publications/index.html | head`
Expected: matches (Le Roux-authored publications linked).

- [ ] **Step 4: Commit** *(user runs)*

```bash
git add packages/website/src/layouts/BooksLayout.astro packages/website/src/layouts/PublicationsLayout.astro
git commit -m "feat(geo): pass Person @id into book and publication schemas"
```

---

### Task 5: Explicit AI-crawler welcome in `robots.txt`

Make the "allow everything" decision explicit and robust by naming the major AI agents. The wildcard already permits them; the named blocks document intent.

**Files:**
- Modify: `packages/website/src/pages/robots.txt.js`

- [ ] **Step 1: Rewrite the endpoint**

Replace the whole of `packages/website/src/pages/robots.txt.js` with:

```js
// AI agents are explicitly welcome to crawl, index, train on, and cite this
// site (GEO). The wildcard `User-agent: *` below already permits everyone; the
// named blocks document that intent and stay robust if a default-deny is ever
// introduced. Grouping multiple User-agent lines before one Allow is valid
// robots.txt and keeps the file compact.
const AI_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
];

export const GET = ({ site }) => {
  const sitemap = new URL('/sitemap-index.xml', site).href;
  const aiBlock = AI_AGENTS.map((a) => `User-agent: ${a}`).join('\n');
  return new Response(
    `# AI agents are explicitly welcome to crawl, index, train on, and cite this site.
${aiBlock}
Allow: /

User-agent: *
Allow: /

Sitemap: ${sitemap}
`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
};
```

- [ ] **Step 2: Build and inspect the output**

Run: `yarn frontend:build`
Then: `grep -E 'GPTBot|ClaudeBot|PerplexityBot|User-agent: \*|Sitemap:' packages/website/dist/robots.txt`
Expected: all named agents, the wildcard block, and the `Sitemap:` line are present.

- [ ] **Step 3: Commit** *(user runs)*

```bash
git add packages/website/src/pages/robots.txt.js
git commit -m "feat(geo): explicitly welcome AI crawlers in robots.txt"
```

---

### Task 6: Generate `/llms.txt`

A machine-only, build-time-generated Markdown map of the site for LLM tooling, following the llmstxt.org convention. Bilingual: FR and EN pages in separate sections. Derived from `identity.json` + the `pages` collection so it never drifts.

**Files:**
- Create: `packages/website/src/pages/llms.txt.js`

- [ ] **Step 1: Create the endpoint**

Create `packages/website/src/pages/llms.txt.js` with:

```js
import { getCollection } from 'astro:content';
import { identity } from '../lib/identity.mjs';

// Strip the ".fr"/".en" suffix from a content-collection entry id to get the
// URL path stem ("home", "cv", "livres/cigda").
const pathOf = (id) => id.replace(/\.(fr|en)$/, '');

// Recognised external-profile hosts → human label for the "External profiles"
// section. Unknown hosts fall back to the bare URL.
const profileLabel = (url) => {
  if (url.includes('orcid.org')) return 'ORCID';
  if (url.includes('scholar.google')) return 'Google Scholar';
  if (url.includes('researchgate.net')) return 'ResearchGate';
  if (url.includes('sciencespo.fr')) return 'CEVIPOF directory';
  if (url.includes('map5')) return 'MAP5';
  return url;
};

export const GET = async ({ site }) => {
  const origin = site.href.replace(/\/$/, '');
  const pages = await getCollection('pages');

  const urlOf = (entry) => {
    const path = pathOf(entry.id);
    const en = entry.data.locale === 'en';
    if (path === 'home') return `${origin}${en ? '/en/' : '/'}`;
    return `${origin}${en ? '/en' : ''}/${path}/`;
  };

  // Curated index: top-level pages only (no "/" in the path stem). Detail pages
  // under livres/* and publications/* are reachable from their listing pages.
  const topLevel = pages.filter((p) => !pathOf(p.id).includes('/'));
  // home first (empty sort key), then alphabetical by path stem — resilient if
  // new pages are added later.
  const orderKey = (p) => (pathOf(p.id) === 'home' ? '' : pathOf(p.id));
  const byLocale = (loc) =>
    topLevel
      .filter((p) => p.data.locale === loc)
      .sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

  const bullet = (entry) => {
    const desc = entry.data.description ? `: ${entry.data.description}` : '';
    return `- [${entry.data.title}](${urlOf(entry)})${desc}`;
  };

  // Books come from the FR livres page's inlined array, newest first.
  const livres = pages.find((p) => p.id === 'livres.fr');
  const books = (livres?.data.books ?? []).slice().sort((a, b) => b.year - a.year);
  const bookBullet = (b) => {
    const href = b.external || (b.page_slug ? `${origin}/${b.page_slug}/` : null);
    const link = href ? `[${b.title}](${href})` : b.title;
    return `- ${link} (${b.year}, ${b.publisher})`;
  };

  const summary =
    identity.description?.fr ||
    `${identity.name} — ${identity.jobTitle.fr}, ${identity.affiliation
      .map((a) => a.name)
      .join(' ; ')}.`;

  const body = `# ${identity.name}

> ${identity.jobTitle.fr} / ${identity.jobTitle.en}. ${identity.affiliation
    .map((a) => a.name)
    .join(' · ')}.

${summary}

Ce site est bilingue : pages françaises à la racine, pages anglaises sous \`/en/\`.
This site is bilingual: French pages at the root, English pages under \`/en/\`.

## Pages (français)
${byLocale('fr').map(bullet).join('\n')}

## Pages (English)
${byLocale('en').map(bullet).join('\n')}

## Books
${books.map(bookBullet).join('\n')}

## External profiles
${identity.sameAs.map((url) => `- ${profileLabel(url)}: ${url}`).join('\n')}
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
};
```

- [ ] **Step 2: Build and inspect the output**

Run: `yarn frontend:build`
Then: `sed -n '1,40p' packages/website/dist/llms.txt`
Expected: H1 `# Brigitte Le Roux`, a blockquote line, the summary paragraph, `## Pages (français)` and `## Pages (English)` sections with absolute `https://brigitte-le-roux.com/...` links, a `## Books` section newest-first (CIGDA 2019 near top), and a `## External profiles` section listing ORCID / Google Scholar / ResearchGate / CEVIPOF directory.

- [ ] **Step 3: Sanity-check the links and books**

Run: `grep -c 'https://brigitte-le-roux.com' packages/website/dist/llms.txt`
Expected: a count ≥ 10 (FR pages + EN pages + profiles).

Run: `grep -E 'Combinatorial Inference|Geometric Data Analysis' packages/website/dist/llms.txt`
Expected: the two books (CIGDA, GDA) appear under `## Books`.

- [ ] **Step 4: Commit** *(user runs)*

```bash
git add packages/website/src/pages/llms.txt.js
git commit -m "feat(geo): generate /llms.txt site map for LLM tooling"
```

---

### Task 7: Documentation — GEO subsection in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (add a `## GEO` section after the existing `## SEO` section)

- [ ] **Step 1: Add the GEO section**

Insert a new section immediately after the end of the `## SEO` section (before `## Build & deploy`) in `CLAUDE.md`:

```markdown
## GEO

GEO (Generative Engine Optimization) makes the site a well-understood, citable
entity for AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Claude,
Gemini). It is markup-only — nothing here changes what human visitors see.

- **AI crawlers** — `src/pages/robots.txt.js` explicitly welcomes the major AI
  agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, …) in
  addition to the `User-agent: *` wildcard. The "allow everything" decision is
  intentional; edit the `AI_AGENTS` list to adjust.
- **`/llms.txt`** — `src/pages/llms.txt.js` generates a curated Markdown map of
  the site (bio, FR + EN pages, books, external profiles) at build time from
  `content/identity.json` and the `pages` collection. It never needs manual
  upkeep; new pages and books appear automatically on rebuild.
- **Entity graph** — the `Person` node carries a stable `@id` of
  `${site}#person` (`personId()` in `src/lib/schema.mjs`). `bookSchema` and
  `publicationSchema` link Brigitte's authorship (`startsWith('Le Roux')`) to
  that `@id` instead of an anonymous author; `websiteSchema` declares her as the
  site's `author`/`about`. JSON-LD consumers merge these by `@id` across the
  separate `<script>` tags each layout emits.
- **Person facts** — `description` and `knowsAbout` (FR/EN) live in
  `content/identity.json`, validated in `src/lib/identity.mjs`, and surface in
  the Person JSON-LD per locale.

Deferred (future spec): a visible FAQ / definition blocks and the `FAQPage`
JSON-LD that legitimately requires visible Q&A; an `/llms-full.txt` full-text
dump.
```

- [ ] **Step 2: Commit** *(user runs)*

```bash
git add CLAUDE.md
git commit -m "docs(geo): document AI crawler policy, llms.txt and entity graph"
```

---

## Final verification (after all tasks)

- [ ] **Unit tests pass:** `yarn --cwd packages/website test:schema` → all PASS.
- [ ] **Build is clean:** `yarn frontend:build` → no errors; `dist/robots.txt`, `dist/llms.txt` present.
- [ ] **Entity graph present:** `grep -l '#person' packages/website/dist/index.html packages/website/dist/livres/index.html packages/website/dist/publications/index.html` → all three match.
- [ ] **No human-visible change:** the rendered HTML body of the pages is unchanged (only `<head>` JSON-LD and the two text endpoints differ). Spot-check `dist/index.html` visually if desired.

## Post-deploy (manual, once — not part of the coding tasks)

- View-source `https://brigitte-le-roux.com/llms.txt` and `/robots.txt`.
- Schema Markup Validator (https://validator.schema.org) on the home page and `/livres/` — confirm the `Person` node has `@id`, `description`, `knowsAbout`, and that `Book`/`WebSite` nodes reference the Person `@id` (no orphan anonymous author for Brigitte).
- Rich Results Test — confirm no regression on existing Person/Book/Article eligibility.
