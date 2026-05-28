# Spec — SEO uplift (schema, content, speed)

**Date:** 2026-05-28

## Background

The 2026-05-17 SEO foundation (`docs/superpowers/specs/2026-05-17-seo-design.md`)
shipped meta tags, Open Graph, Twitter cards, hreflang, sitemap and robots.txt.
That spec explicitly deferred:

- JSON-LD / Person structured data.
- Google Search Console verification meta tag.
- Per-page Open Graph image overrides.
- Performance optimizations (LCP, font-related).

This spec picks up the first, second and fourth of those deferrals, plus
narrow per-page meta descriptions on the 6 highest-leverage pages. Per-page
`og:image` overrides remain deferred.

## Goals

Priority order:

1. **Brand authority for "Brigitte Le Roux"** — Google should treat her as a
   first-class entity. Knowledge-panel-style result, rich snippets, verifiable
   identity via `sameAs` to ORCID, Google Scholar, ResearchGate and the
   institutional pages.
2. **Methodology terms** — rank for "analyse géométrique des données",
   "analyse des correspondances multiples", "Geometric Data Analysis",
   "Multiple Correspondence Analysis", and related FR/EN terms.

Scope is **on-site only**. No off-site outreach, no profile claiming, no
backlink work in this spec.

## Non-goals

- Analytics tracker (Plausible, Umami, GA). Search Console covers SEO
  measurement without cookies.
- Per-page `og:image` overrides (still deferred from the 2026-05-17 spec).
- WebP/AVIF image variants for `public/data/*`.
- Editorial rewrites beyond the 6 priority pages.
- Backlink strategy or institutional outreach.
- FAQ / Q&A schema, breadcrumb schema beyond detail pages.
- Automated SEO monitoring tooling.

## Architecture

### 1. Identity — `content/identity.json` (new)

Single source of truth for the JSON-LD `Person` schema. Locale-agnostic since
identity URLs and IDs do not translate.

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
    { "name": "MAP5", "url": "https://map5.mi.parisdescartes.fr/" },
    { "name": "CEVIPOF", "url": "https://www.sciencespo.fr/cevipof/" }
  ],
  "sameAs": [
    "https://orcid.org/<orcid-id>",
    "https://scholar.google.com/citations?user=<scholar-id>",
    "https://www.researchgate.net/profile/<rg-id>",
    "https://map5.mi.parisdescartes.fr/membres/leroux/",
    "https://www.sciencespo.fr/cevipof/fr/users/brigitte-leroux"
  ]
}
```

Unknown `sameAs` entries: leave them out of the array entirely (or set the
whole `sameAs` to `[]`). The schema builder also strips entries that fail
URL validation — but the JSON file should not ship literal `<orcid-id>`
placeholder strings; the example above shows shape only.

### 2. Schema builders — `src/lib/schema.mjs` (new)

Pure functions, no Astro dependency. Each returns a plain JS object (or
array). Fields with no value are omitted.

```js
personSchema(identity, site, locale)   // Person + sameAs + affiliation
websiteSchema(site, locale)            // WebSite + SearchAction (home only)
bookSchema(book)                       // Book — from books: frontmatter entry
publicationSchema(pub)                 // dispatches on pub.type:
                                       //   article → ScholarlyArticle
                                       //   book    → Book
                                       //   chapter → Chapter
                                       //   slides  → PresentationDigitalDocument
breadcrumbList(items)                  // BreadcrumbList for detail pages
```

### 3. Rendering — `src/components/StructuredData.astro` (new)

```astro
---
const { schema } = Astro.props;
const items = Array.isArray(schema) ? schema : [schema];
const graph = items.length === 1
  ? items[0]
  : { '@context': 'https://schema.org', '@graph': items };
---
<script type="application/ld+json" set:html={JSON.stringify(graph)}></script>
```

Single emission point so escaping and `@graph` wrapping live in one place.
`set:html` is safe here: the input is structured data we build ourselves, not
user input.

### 4. Schema injection

- `BaseLayout.astro` → `personSchema(identity, site, locale)` on every page.
- `HomeLayout.astro` → additionally `websiteSchema(site, locale)`.
- `BooksLayout.astro` → one `bookSchema(book)` per `books:` entry, plus
  optional entries for `translated_books:` and `book_chapters:` if their
  frontmatter shape exposes the required fields.
- `PublicationsLayout.astro` → one `publicationSchema(pub)` per entry.
- `PageLayout.astro` → `breadcrumbList(...)` **only when** the entry path
  contains at least one `/` (i.e. detail pages under `livres/*` such as
  `livres/cigda.fr.md`). Top-level narrative pages skip it (path has no
  parent segment, so the breadcrumb would be trivial).

### 5. Font self-hosting — replaces Google Fonts CDN

**Current state** (`BaseLayout.astro:74-76`):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:...&family=Bricolage+Grotesque:..." rel="stylesheet" />
```

Two third-party preconnects + one render-blocking stylesheet on every page
load. Both fonts ship under SIL Open Font License, so self-hosting is
permitted.

**New state:**

- `public/fonts/fraunces-variable.woff2`, `bricolage-grotesque-variable.woff2`
  (variable fonts cover all weights/widths in one file each).
- `@font-face` declarations in `theme.css` with `font-display: swap`.
- One `<link rel="preload" as="font" type="font/woff2" crossorigin>` per
  critical font in `BaseLayout.astro`.
- Remove the three Google Fonts `<link>` tags.

Expected impact: LCP/FCP improvement, render-blocking-resources warning
resolved in Lighthouse, third-party DNS lookup gone from every page load.
Side benefit: visitors' IPs no longer disclosed to Google for font requests.

### 6. Search Console verification

Single `<meta name="google-site-verification" content="..." />` tag in
`BaseLayout.astro`, value supplied by Search Console after the property is
added. Until value is known the tag is omitted (no placeholder).

### 7. Per-page meta descriptions — editorial change only

The frontmatter schema in `src/content/config.mjs` already accepts optional
`description` and `keywords` strings; `BaseLayout.astro` already uses them
with fallback to the i18n defaults. So this section is **pure content work**:
add `description:` and `keywords:` to 12 frontmatter blocks (6 pages × 2
locales).

| Page (FR/EN)             | Keyword focus                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `home.{fr,en}.md`        | Name + AGD/GDA + MAP5 + CEVIPOF / Université Paris Cité                                                      |
| `recherches.{fr,en}.md`  | Analyse géométrique des données, ACM, sociologie quantitative / Geometric Data Analysis, MCA, case studies   |
| `livres.{fr,en}.md`      | CIGDA, GDA, Chapman & Hall/CRC, ISBN-indexed terms                                                           |
| `publications.{fr,en}.md`| Bourdieu + champ + sociologie / Bourdieu + field; co-authors Lebaron, Bonnet, Rouanet                        |
| `these.{fr,en}.md`       | Thèse HDR + AGD / Thesis HDR + GDA                                                                           |
| `logiciels.{fr,en}.md`   | Eyelid, ADDAD, software names, downloadable datasets                                                         |

Skipped: `cv.{fr,en}.md`, `ateliers.{fr,en}.md`, `bureau.fr.md`. Prose
length: ~150–160 characters (Google SERP truncation).

### 8. Content schema additions — `src/content/config.mjs`

```js
// Validate identity.json
const identitySchema = z.object({
  name: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  jobTitle: z.object({ fr: z.string(), en: z.string() }),
  affiliation: z.array(z.object({ name: z.string(), url: z.string().url() })),
  sameAs: z.array(z.string().url())
});
```

No changes to existing page schemas (the `description` and `keywords` fields
already exist).

## Files touched

**New:**

- `content/identity.json`
- `src/lib/schema.mjs`
- `src/components/StructuredData.astro`
- `public/fonts/fraunces-variable.woff2`
- `public/fonts/bricolage-grotesque-variable.woff2`

**Edited:**

- `src/layouts/BaseLayout.astro` (+ Person schema, + Search Console verify,
  + font preload, – Google Fonts links)
- `src/layouts/HomeLayout.astro` (+ WebSite schema)
- `src/layouts/BooksLayout.astro` (+ Book schemas)
- `src/layouts/PublicationsLayout.astro` (+ Article/Book/Chapter schemas)
- `src/layouts/PageLayout.astro` (+ BreadcrumbList, conditional on detail pages only)
- `src/styles/theme.css` (+ @font-face declarations)
- `src/content/config.mjs` (+ identitySchema export)
- `content/pages/{home,recherches,livres,publications,these,logiciels}.{fr,en}.md`
  (+ description, keywords frontmatter — 12 files)
- `CLAUDE.md` (short subsection pointing at `identity.json` and explaining the
  JSON-LD injection layout)

## Verification

### Build-time

- Schema builders return plain JS objects. A failing `JSON.stringify` round-trip
  on any emitted schema fails the build.
- Each layout asserts the expected schema types are emitted (Home → Person +
  WebSite; Livres → Person + Book × N; etc.).

### Post-deploy (manual, run once)

- **Rich Results Test** — https://search.google.com/test/rich-results on
  home, one book detail page, one publication entry. Expect "eligible for
  rich results" with Person / Book / ScholarlyArticle detected.
- **Schema Markup Validator** — https://validator.schema.org as second
  opinion (catches typos Google's tool ignores).
- **PageSpeed Insights** — https://pagespeed.web.dev/ before and after font
  self-hosting. Expect LCP/FCP improvement, "Eliminate render-blocking
  resources" warning gone.
- **View-source** on home + one of each layout type confirms exactly one
  `<script type="application/ld+json">` per page (or one per `@graph`).

### Long-term (4–12 weeks)

Tracked via Google Search Console:

- Brand query "Brigitte Le Roux" — average position 1, CTR rising as rich
  snippets surface.
- Methodology terms — rising impressions for AGD/MCA/GDA queries (FR + EN).
- Indexed pages count — all 34 URLs indexed, no blocking exclusions.
- Knowledge-panel-style result on logged-out Google.com SERP (visual check,
  no API).

## Open questions

- **`bookSchema` field coverage** — the `books:` frontmatter has slug, title,
  authors, year, publisher, ISBN, optional `book_review_url` / `reviews`.
  Schema.org `Book` accepts all of these; `Review` is its own type. Decide
  at implementation whether `reviews:` entries become nested `Review`
  objects on the parent Book, or are skipped to keep payload small.
- **`@graph` per page vs. per script tag** — single `@graph` containing all
  schemas is cleaner; multiple `<script>` tags is also valid. Pick one at
  implementation; both work for Google.
- **Identity values** — actual ORCID, Scholar, ResearchGate, MAP5, CEVIPOF
  URLs must be supplied before deploy (or `sameAs` ships empty, which is
  valid but loses the main brand-authority signal). Not a code question;
  an editorial dependency.
