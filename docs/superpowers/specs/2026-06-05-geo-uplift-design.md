# Spec — GEO uplift (markup-only)

**Date:** 2026-06-05

## Background

The SEO work (`docs/superpowers/specs/2026-05-28-seo-uplift-design.md` and its
predecessor) shipped the on-site SEO stack: meta/OG/Twitter tags, hreflang,
sitemap, `robots.txt`, self-hosted fonts, and JSON-LD (`Person`, `WebSite`,
`Book`, `ScholarlyArticle`/`Chapter`/`PresentationDigitalDocument`,
`BreadcrumbList`). Identity facts are centralised in
`packages/website/content/identity.json`, validated by Zod in
`src/content/config.mjs`, and rendered by pure builders in `src/lib/schema.mjs`
through one component, `src/components/StructuredData.astro`.

This spec is the next layer: **GEO — Generative Engine Optimization**. The goal
is to make brigitte-le-roux.com a *well-understood, citable entity* for AI
answer engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Gemini) when
they answer queries about Brigitte Le Roux as a person, about her methodology
(Geometric Data Analysis / Multiple Correspondence Analysis), about her books
and publications, and about the GDA↔Bourdieu/quantitative-sociology link.

## Goals

1. **Be crawlable and welcome to AI agents** — make the "allow everything"
   crawler decision explicit and robust.
2. **Be orientable** — give AI tooling a curated, machine-readable map of the
   site at `/llms.txt`.
3. **Be a coherent entity** — harden the `Person` node (description,
   `knowsAbout`, stable `@id`) so engines understand who she is and what she is
   an authority on.
4. **Be a connected knowledge graph** — link every authored book and
   publication back to her `Person` entity by `@id`, so her body of work is
   attributed to her node rather than to anonymous author objects.

## Scope

**Markup-only.** Every change is invisible to human visitors: `robots.txt`,
a new machine-only `/llms.txt`, JSON-LD enrichment, and machine-readable fields
in `identity.json`. The rendered pages read exactly as they do today.

Light human-visible content (an FAQ section, definition blocks) and the
`FAQPage` JSON-LD that legitimately requires visible Q&A are **deferred** to a
follow-up spec — the amount of such content will be decided separately.

## Non-goals

- **`FAQPage` JSON-LD** — requires visible on-page Q&A (Google forbids marking
  up hidden FAQ content). Deferred with the "light content" follow-up.
- **`/llms-full.txt`** — a concatenated full-text dump of every page. The site
  is clean static HTML and fully crawlable, and every AI bot is explicitly
  allowed (component A), so bots can read the real pages directly; a duplicated
  full-text file adds a drift-prone maintenance surface for low marginal gain.
  Deferred.
- **Editorial rewrites** of existing prose.
- **Off-site work** — profile claiming, backlinks, Wikipedia/Wikidata edits,
  institutional outreach.
- **`alumniOf` / awards** on the `Person` — left out until the underlying facts
  are supplied; `identity.json` fields are optional so they can be added later
  with no code change.
- Analytics, monitoring tooling.

## Architecture

### A. Explicit AI-crawler welcome — `src/pages/robots.txt.js`

**Current state:**

```
User-agent: *
Allow: /

Sitemap: <origin>/sitemap-index.xml
```

The wildcard already permits every bot, AI agents included. This change makes
the intent explicit and robust against a future default-deny: prepend named
`Allow: /` blocks for the major AI agents, keep the wildcard catch-all, and add
a comment documenting the decision. The generated output becomes:

```
# AI agents are explicitly welcome to crawl, index, train on, and cite this
# site. The wildcard below already permits everyone; the named blocks document
# intent and stay robust if a default-deny is ever introduced.
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: anthropic-ai
User-agent: Claude-Web
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
User-agent: Bytespider
Allow: /

User-agent: *
Allow: /

Sitemap: <origin>/sitemap-index.xml
```

(Grouping consecutive `User-agent` lines before one `Allow` is valid robots.txt
and keeps the file compact. The endpoint stays a build-time `GET` returning
`text/plain`, deriving the sitemap URL from `site` exactly as today.)

### B. `/llms.txt` — new build endpoint `src/pages/llms.txt.js`

A machine-only Markdown document served at `/llms.txt`, following the
llmstxt.org convention (H1 title, blockquote summary, then link sections).
**Generated at build time** from `identity.json` and the `pages` content
collection so it never drifts from the site. Bilingual: FR and EN pages are
listed in separate sections.

Structure of the emitted file:

```markdown
# Brigitte Le Roux

> Mathematician (Geometric Data Analysis, Multiple Correspondence Analysis),
> affiliated with MAP5 (Université Paris Cité) and CEVIPOF (CNRS / Sciences Po).

Brigitte Le Roux is a researcher in geometric data analysis. Her work develops
and applies Multiple Correspondence Analysis (MCA) and the geometric approach
to data analysis, with applications in quantitative sociology and links to
Pierre Bourdieu's field theory. This site is bilingual: French pages at the
root, English pages under `/en/`.

## Pages (français)
- [Accueil](<origin>/): ...
- [Recherches](<origin>/recherches/): ...
- [Livres](<origin>/livres/): ...
- [Publications](<origin>/publications/): ...
- ...one bullet per FR narrative + listing page...

## Pages (English)
- [Home](<origin>/en/): ...
- ...one bullet per EN page...

## Books
- [Combinatorial Inference in Geometric Data Analysis](<external-or-page-url>) (2019, Chapman & Hall/CRC)
- ...one bullet per books: entry, newest first...

## External profiles
- ORCID: <orcid url>
- Google Scholar: <scholar url>
- ResearchGate: <rg url>
- CEVIPOF directory: <cevipof url>
```

Sourcing rules:

- **Summary / fact paragraph** — built from `identity.json`
  (`description` if present, else composed from `jobTitle` + `affiliation` +
  `knowsAbout`). Locale: FR (site default) for the prose, since `/llms.txt` is
  a single file; English pages still appear in their own section.
- **Page bullets** — `getCollection('pages')`, split by locale from the entry
  filename/slug convention, each bullet using the page `title` and (if set)
  `description`. The home and listing pages are included alongside narrative
  pages.
- **Books** — read the `books:` array from the `livres` page entry, sorted by
  `year` descending (mirroring the listing route), linking to `external` or the
  detail `page_slug` when present.
- **External profiles** — the `sameAs` array from `identity.json`, labelled by
  recognised host (orcid.org → "ORCID", scholar.google.* → "Google Scholar",
  researchgate.net → "ResearchGate", sciencespo.fr → "CEVIPOF directory");
  unknown hosts fall back to the bare URL.

Implementation mirrors `robots.txt.js`: an exported `GET` returning a
`text/plain` `Response` (llmstxt.org serves `text/plain`; the body is Markdown).
URLs are absolute, derived from `site`.

### C. Person entity hardening — `identity.json`, `schema.mjs`, `config.mjs`

**`identity.json`** gains two optional, machine-only fields (no rendered
change):

```json
{
  "description": {
    "fr": "Brigitte Le Roux est chercheuse en analyse géométrique des données ...",
    "en": "Brigitte Le Roux is a researcher in geometric data analysis ..."
  },
  "knowsAbout": {
    "fr": [
      "Analyse géométrique des données",
      "Analyse des correspondances multiples",
      "Statistique",
      "Sociologie quantitative",
      "Théorie des champs de Bourdieu"
    ],
    "en": [
      "Geometric Data Analysis",
      "Multiple Correspondence Analysis",
      "Statistics",
      "Quantitative sociology",
      "Bourdieu's field theory"
    ]
  }
}
```

**`personSchema(identity, site, locale)`** (`src/lib/schema.mjs`) gains:

- `@id` — a stable canonical identifier, `${site}#person` (where `site` already
  has its trailing slash stripped by the caller). This is the anchor the whole
  entity graph references.
- `description` — `identity.description?.[locale]` (falls back to `.fr`),
  omitted if absent.
- `knowsAbout` — `identity.knowsAbout?.[locale]` (falls back to `.fr`), omitted
  if absent.

`compact()` already drops absent fields, so partial `identity.json` stays
valid.

**`identitySchema`** (`src/content/config.mjs`) extends with the two optional
fields:

```js
description: z.object({ fr: z.string(), en: z.string() }).optional(),
knowsAbout: z.object({ fr: z.array(z.string()), en: z.array(z.string()) }).optional(),
```

### D. Entity-graph `@id` linking — `src/lib/schema.mjs`

The structural centerpiece. A shared, stable Person `@id` lets every authored
work attribute itself to her node, and lets `WebSite` declare her as its
subject. JSON-LD consumers merge nodes by `@id` **across separate `<script>`
tags**, so the existing one-script-per-layout emission (BaseLayout → Person,
BooksLayout → Books, etc.) needs no restructuring — only a consistent `@id`.

- **Shared id helper** — derive `personId(site)` → `${site}#person` once, used by
  `personSchema` (component C) and by the builders below. `site` is already the
  trailing-slash-stripped origin everywhere it is passed.
- **`bookSchema(book, personId)`** — when an author name equals
  `identity.name` ("Brigitte Le Roux"), emit `{ "@id": personId }` for that
  author entry instead of the anonymous `{ "@type": "Person", name }`. Other
  authors stay plain `Person` objects (no IDs available for co-authors).
- **`publicationSchema(pub, personId)`** — identical author-matching rule.
- **`websiteSchema(site, locale)`** — add `author: { "@id": personId }` and
  `about: { "@id": personId }`, declaring the site's subject/owner entity.

**Threading `personId` and the matched name.** The author-matching builders
need (a) the Person `@id` and (b) the canonical name to match against. Both
derive from `site` + `identity.name`. The cleanest minimal change:

- Export a tiny helper `personId(site)` and a name constant resolved from
  `identity`. The layouts (`BooksLayout`, `PublicationsLayout`) already have
  `Astro.site` and import `identity` is available via the same path BaseLayout
  uses (`content/identity.json`). Each layout computes
  `const pid = personId(Astro.site.href.replace(/\/$/, ''))` and passes it plus
  `identity.name` into the builder, or—simpler—passes `identity` + `site` and
  lets the builder compute both. Decide the exact signature at implementation;
  the behaviour is fixed: Brigitte's author entries become `{ "@id": personId }`.

This is the highest-leverage GEO change: it converts a flat list of works with
anonymous authors into a connected graph centred on her entity.

### Docs — `CLAUDE.md`

Add a short **GEO** subsection (sibling of the existing SEO section):

- `/llms.txt` is generated by `src/pages/llms.txt.js` from `identity.json` +
  the `pages` collection; regenerated every build, no manual upkeep.
- `robots.txt` explicitly welcomes AI agents (the "allow everything" policy).
- The Person `@id` convention (`${site}#person`) and the rule that authored
  books/publications link to it by `@id`.
- Pointer that FAQ/visible content + `FAQPage` schema are a deferred follow-up.

## Files touched

**New:**

- `packages/website/src/pages/llms.txt.js`

**Edited:**

- `packages/website/src/pages/robots.txt.js` (explicit AI-agent allow blocks)
- `packages/website/content/identity.json` (+ `description`, `knowsAbout`)
- `packages/website/src/lib/schema.mjs` (Person `@id`/`description`/`knowsAbout`;
  `personId` helper; author `@id` linking in `bookSchema`/`publicationSchema`;
  `author`/`about` in `websiteSchema`)
- `packages/website/src/content/config.mjs` (identitySchema: optional
  `description`, `knowsAbout`)
- `packages/website/src/layouts/BooksLayout.astro` (pass `personId` into
  `bookSchema`)
- `packages/website/src/layouts/PublicationsLayout.astro` (pass `personId` into
  `publicationSchema`)
- `CLAUDE.md` (GEO subsection)

`BaseLayout.astro` and `HomeLayout.astro` need editing only if the chosen
`websiteSchema`/`personSchema` signatures change (e.g. `websiteSchema` taking
`personId`); the `@id` is derived from the `site` value they already pass.

## Verification

### Build-time

- `yarn --cwd packages/website test:schema` — extend `schema.test.mjs`:
  - `personSchema` emits `@id === ${site}#person`, and includes `description`
    + `knowsAbout` when present in identity, omits them when absent.
  - `bookSchema` / `publicationSchema`: an authors array containing
    "Brigitte Le Roux" yields an author entry `{ "@id": personId }`; co-author
    entries remain `{ "@type": "Person", name }`.
  - `websiteSchema` includes `author`/`about` referencing `personId`.
  - All builders survive a `JSON.stringify` round-trip.
- `yarn frontend:build` succeeds; `/llms.txt` and `/robots.txt` are emitted into
  `dist/`.

### Post-deploy (manual, once)

- **View-source `/llms.txt`** — well-formed Markdown, absolute URLs, FR + EN
  page sections, books newest-first, external profiles labelled.
- **View-source `/robots.txt`** — named AI-agent blocks + wildcard + sitemap.
- **Schema Markup Validator** (https://validator.schema.org) on the home page
  and one book listing page — confirm the `Person` node carries `@id`,
  `description`, `knowsAbout`, and that `Book`/`WebSite` nodes reference the
  Person `@id` (connected graph, no orphan anonymous authors for Brigitte).
- **Rich Results Test** — no regression on existing Person/Book/Article
  eligibility.

### Long-term (4–12 weeks)

- Spot-check answer engines ("Who is Brigitte Le Roux?", "What is Geometric
  Data Analysis?", "Who developed the geometric approach to Multiple
  Correspondence Analysis?") for citation of brigitte-le-roux.com.
- Server logs / Search Console show AI-agent user-agents fetching `/llms.txt`
  and pages.

## Open questions

- **`websiteSchema` / builder signatures** — exact parameter shape for passing
  `personId` (and the match-name) into `bookSchema`/`publicationSchema`/
  `websiteSchema`. Behaviour is fixed; only the function signatures are an
  implementation detail.
- **`/llms.txt` prose locale** — the single file's summary paragraph is written
  in FR (site default) with both locales' pages linked. Confirm FR-prose is
  acceptable vs. a short English summary line as well.
- **`description` wording** — the FR/EN bio sentences in `identity.json` need
  final copy; draft at implementation, confirm with the editor.
