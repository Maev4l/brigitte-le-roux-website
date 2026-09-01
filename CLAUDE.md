# brigitte-le-roux.com

Personal academic site for Brigitte Le Roux (mathematician, MAP5 / CEVIPOF–CNRS).
Bilingual (FR default, EN at `/en/...`). Static Astro build deployed to S3 +
CloudFront on `brigitte-le-roux.com`.

## Stack

- Astro 5 (static output), Yarn, strict version pinning, no TypeScript.
- `aws-amplify` v6 (auth only) + `esbuild` are the sole non-Astro deps —
  both exist for the CMS sign-in shim; see **CMS sign-in** below.
- Monorepo layout: `packages/website/` (Astro site), `packages/infrastructure/`
  (Terraform). Yarn workspaces are NOT used — there is no root
  `package.json`; a top-level `Makefile` carries convenience targets
  (`frontend-*`, `backend-*`, `infra-*`) that delegate via `yarn --cwd`,
  `make -C` and `terraform -chdir`. Each package has its own
  `package.json` with its own strict-pinned deps. Dev server on port `4321`.
- Theme tokens in `packages/website/src/styles/theme.css` — Fraunces (display),
  Bricolage Grotesque (UI), vermillion kicker on parchment ground.

## Content model

**Principle: one page = one file (per locale).** All editorial content for
a page — including book and publication listings — lives in that page's
markdown file. No separate `packages/website/content/books/`, `packages/website/content/publications/`, or
`packages/website/content/data/*.json` indirection. Adding or editing an entry means editing
exactly one file in each locale.

### Flat file layout

Per-locale filenames are flat — `<slug>.<locale>.md` rather than
`<slug>/<locale>.md`. This restores direct URL ↔ file-path symmetry:

- Top-level pages: `packages/website/content/pages/<slug>.<locale>.md`
  - `pages/cv.fr.md` ↔ `/cv/` (and `pages/cv.en.md` ↔ `/en/cv/`)
  - `pages/home.{fr,en}.md` ↔ `/` and `/en/`
  - `pages/livres.{fr,en}.md` ↔ `/livres/` (and EN equivalent)
- Detail pages (one extra path segment):
  `packages/website/content/pages/<parent>/<slug>.<locale>.md`
  - `pages/livres/cigda.fr.md` ↔ `/livres/cigda/`

### Frontmatter fields

Validated by the Zod schema in `packages/website/src/content/config.mjs`:

- Common: `title`, `locale`, `slug`, optional `description`, optional
  `keywords`.
- **`category: narrative`** (optional) — marker on narrative pages
  (`cv`, `recherches`, `ateliers`, `these`, `logiciels`, `bureau`).
  Used by Sveltia's Folder collection `filter` to surface just these
  pages in the CMS "Pages" collection. The home/livres/publications
  listing pages deliberately OMIT this field — they live in their own
  dedicated Sveltia File collections.
- **`page_layout: home | books | publications`** (optional) —
  catch-all route discriminator. When set, the entry renders via the
  matching dedicated layout (`HomeLayout`, `BooksLayout`,
  `PublicationsLayout`); when omitted, the default `PageLayout`. The
  listing pages carry their inline `books:` or `publications:` array.
- Home-only structured fields (when `page_layout: home`): `kicker`,
  `deck_html`, `portrait`, `tiles`.

**i18n strings** — `packages/website/content/i18n/{fr,en}.json` for nav
labels, footer text and common UI strings (key/value translation data —
not editorial content, hence JSON is appropriate here).

Catch-all routes (`packages/website/src/pages/[...slug].astro` and
`packages/website/src/pages/en/[...slug].astro`) derive the URL slug
directly from the entry's path, read `entry.data.books` /
`entry.data.publications` from the page entry, sort by `year`
descending, and render the listing — so the most recent items always
appear first regardless of YAML order.

### Inline listing entries

Each entry is a YAML mapping inside the page's `books:` or `publications:`
array. Schemas in `packages/website/src/content/config.mjs`. Shapes:

```yaml
# In packages/website/content/pages/livres.{fr,en}.md — same data in both files since
# book titles are language-identical on this site.
books:
  - slug: cigda
    title: "Combinatorial Inference in Geometric Data Analysis"
    authors: ["Le Roux, B.", "Bienaise, S.", "Durand, J.-L."]
    year: 2019
    publisher: "Chapman & Hall/CRC"
    isbn: "9781498781619"
    page_slug: "livres/cigda"     # optional — detail page under packages/website/content/pages/
    external: "https://..."        # optional — publisher / external link
    # Two review shapes are supported, mirroring the legacy site:
    book_review_url: "https://..." # optional — ONE external review URL,
                                   #   rendered as " · recension" / "book review"
                                   #   inline after `external`. Used by CIGDA.
    reviews:                       # optional — LIST of locally-archived reviews,
                                   #   rendered as a nested <ul> under the entry
                                   #   with a "Revues critiques" / "Book reviews"
                                   #   label. Used by GDA.
      - reviewer: "J. Hjellbrekke"
        venue: "European Sociological Review"
        year: 2005
        url: "/data/Kl_Hjellbrekke.pdf"
```

```yaml
# In packages/website/content/pages/publications.{fr,en}.md — each locale's page carries
# its own `title` for each entry (titles often genuinely differ FR/EN).
publications:
  - slug: lebaron-le-roux-2013-geometrie-champ
    year: 2013
    title: "Géométrie du champ"          # FR file. EN file has the English title.
    authors: ["Lebaron, F.", "Le Roux, B."]
    venue: "Actes de la recherche en sciences sociales"
    type: "article"                       # article | book | chapter | slides
    pdf: "/data/foo.pdf"                  # optional
    external: "https://..."               # optional
```

The books listing page (`packages/website/content/pages/livres.{fr,en}.md`) also accepts three
optional sub-blocks rendered below the main `books:` list, mirroring the
legacy site's "Livres traduits" / "Translated books", "Chapitres dans des
ouvrages collectifs" / "Book chapters" sections, and the bottom-of-page
"Fichiers de données" / "Data sets" cross-reference. Each block is optional;
each `text_html` is free-prose HTML (because bibliographic citations don't
split cleanly into author/title/venue fields). The route sorts entries by
`year` descending before rendering.

```yaml
# In packages/website/content/pages/livres.{fr,en}.md, after the books: array.
translated_books_title: "Livres traduits"          # locale-specific section header
translated_books:
  - year: 1996
    text_html: "<em>Title</em>. Publisher, Place."

book_chapters_title: "Chapitres dans des ouvrages collectifs"
book_chapters:
  - slug: "<kebab-case-id>"
    year: 2018
    text_html: "Authors (year). Chapter title, chapter N of <em>Book</em>, …"

data_sets_link_html: "Fichiers de données : <a href=\"/logiciels/\">cliquer ici</a>"
```

Adding a new narrative page:

1. Create the markdown pair `packages/website/content/pages/<new-slug>.fr.md`
   and `<new-slug>.en.md`. Set `category: narrative` in the frontmatter
   of each.
2. Add the slug + label to `packages/website/content/i18n/{fr,en}.json`.
3. Add the route to the `items` array in `packages/website/src/components/Header.astro`.

Sveltia's Folder collection auto-discovers the new files via its
`filter: { field: category, value: narrative }` rule — no Sveltia
config change required.

Adding a new book / publication:

1. Open `packages/website/content/pages/livres.{fr,en}.md` (or
   `publications.{fr,en}.md`).
2. Append a new entry to the `books:` (or `publications:`) array per the
   schema above. Both locale files need the entry — for books the YAML is
   identical in both; for publications the `title` field carries the
   locale-specific title.
3. Save. The listing reflects the change immediately on next build, sorted
   by `year` descending.

## Static assets

`packages/website/public/data/` is a single **flat** prefix holding every
binary served verbatim at URL root — PDFs, data files, images, archives —
all addressed as `/data/<basename>`:

- `packages/website/public/data/photoweb.jpg`        → `/data/photoweb.jpg`
- `packages/website/public/data/Kl_Hjellbrekke.pdf`  → `/data/Kl_Hjellbrekke.pdf`
- `packages/website/public/data/CognitiveTests.xls`  → `/data/CognitiveTests.xls`

Why flat? Sveltia's S3 media library shows one consolidated picker per
configured `prefix` — a single bucket of media. Subdirectories complicate
that UX with no editorial benefit. Filenames must therefore be unique;
when ambiguity is possible, prefer descriptive basenames
(`Reviews_Hjellbrekke_2005.pdf`, not `review.pdf`).

**`packages/website/public/` is gitignored.** The canonical store is the production S3 bucket. One file
in `packages/website/public/data/` exceeds GitHub's 100 MB per-file cap, so tracking it in git is not
viable; rather than splitting strategy with Git LFS, the project treats S3 as the
source of truth — which is consistent with how `make frontend-deploy` already works (build →
sync `dist/` to S3).

**Carve-out: `packages/website/public/cms/**` IS git-tracked.** The
Sveltia loader, editorial config (`config.yml`), and OAuth shim that
live there are CODE — they integrate with the github-gateway Lambda and
CloudFront functions and belong in version control next to those, not
in S3-as-canonical. A negation rule in `.gitignore` (`!public/cms/`,
`!public/cms/**`) keeps the carve-out scoped while leaving
`public/data/` ignored as before.

One file inside that carve-out is re-ignored:
`public/cms/auth/auth.js` is a build artefact (see **CMS sign-in** below).
Its source is `packages/website/src/cms-auth/main.js`.

Reference these assets from markdown/JSON as plain absolute paths (e.g.
`[PDF](/data/foo.pdf)`).

**Pulling `packages/website/public/` from S3** — fresh clone, new machine, or any time you want to
sync down updates that another contributor pushed:

```bash
make frontend-pull                            # pull public/data/ from S3
make frontend-pull ARGS="--dry-run"           # preview without writing
make frontend-pull ARGS="--delete"            # also delete local files no longer in S3
```

(Excludes built HTML pages — those are regenerated by `make frontend-build`.)

### CMS sign-in (Cognito)

The editor signs in through a standalone popup at `/cms/auth/`
(`packages/website/public/cms/auth/index.html`) — Sveltia's OAuth shim.
It authenticates against the Cognito user pool with **USER_SRP_AUTH**
via the AWS Amplify JS **v6** auth client, then hands the resulting
`id_token` back to Sveltia over Sveltia's `postMessage` protocol. No
Hosted UI, no OAuth redirect: the editor stays on
`cms.brigitte-le-roux.com` end-to-end.

**The shim's JS is bundled, not inlined.** Source lives in
`packages/website/src/cms-auth/main.js`; `scripts/build-cms-auth.mjs`
bundles it with esbuild to `public/cms/auth/auth.js`, which
`index.html` loads same-origin as a module. The bundle step is wired
into both `yarn dev` and `yarn build`, so it always runs before Astro
copies `public/` into `dist/`.

Three constraints hold this shape in place — change any of them and the
sign-in page breaks:

- **Amplify v6 ships no browser-global build.** There is no script tag
  that yields a usable global, so a bundler is mandatory. (The public
  CDNs can generate an ESM graph on demand, but those files are built
  per request and can therefore never carry an SRI hash — not
  acceptable on the page that reads the editor's password. Hence
  self-hosting.)
- **The output must sit under `/cms/` with a file extension.**
  `cloudfront-cms-function.js` 404s any URI outside `/cms/` and
  `/api/`, and rewrites extensionless `/cms/*` paths to the Sveltia SPA
  shell. `/cms/auth/auth.js` satisfies both rules and falls through to
  S3 untouched; an Astro-page bundle would emit to `/_astro/*.js` and
  404 on the CMS distribution.
- **`signIn` must not be given an `authFlowType`.** Amplify's default
  branch is SRP. The app client enables only `ALLOW_USER_SRP_AUTH`
  (plus refresh), so a downgrade to a plaintext-password flow fails
  closed at Cognito rather than shipping silently.

Amplify keeps its own session in `localStorage`, so `signIn` throws
`UserAlreadyAuthenticatedException` on a second sign-in in the same
browser. The shim calls `signOut()` (errors swallowed) first, which
makes every visit behave like the first.

`yarn --cwd packages/website test:cms-auth` rebuilds the bundle and
asserts the properties above: self-hosted (no third-party CDN in the
bundle or the page), SRP not downgraded, and a gzipped size budget for
the login page.

### Media uploads (via the CMS)

The editor uploads PDFs and images through Sveltia's built-in S3 media
library. Files land at `s3://brigitte-le-roux-website/data/<filename>`
and serve from `https://brigitte-le-roux.com/data/<filename>`. Sveltia
signs the S3 PUT directly from the browser using the IAM user
`brigitte-le-roux-website-sveltia-media-manager` (scoped to
`PutObject`, `PutObjectAcl`, `ListBucket` — see `packages/infrastructure/iam.tf`).
The `access_key_id` is in `public/cms/config.yml`; the secret is
fetched from the media-manager Lambda at login and stashed in
localStorage — the editor never enters credentials.

Three Sveltia quirks shaped the AWS-side config:

- Sveltia hardcodes `x-amz-acl: public-read` on every PUT. The bucket
  runs `BucketOwnerPreferred` Object Ownership (not Enforced) so the
  header is accepted; `block_public_acls = false` paired with
  `ignore_public_acls = true` lets the ACL through the API but
  neutralises its meaning. CloudFront OAC + the bucket policy remain
  the actual read gate.
- Sveltia commits binary uploads to git alongside the markdown edit,
  using a GitHub GraphQL `createCommitOnBranch` mutation routed via
  the github-gateway proxy. The github-gateway's path allowlist
  (`lib/allowlist.mjs`) covers GraphQL mutations as well as the REST
  Contents/Trees endpoints, so only `packages/website/content/*` and
  `packages/website/public/data/*` paths can be committed — anything
  else (e.g. `packages/functions/`, `.github/`) returns 403 from the
  gateway before reaching GitHub. The `data/` allowance is what lets
  Sveltia's binary-bundling-into-commits succeed. `.gitignore` does
  NOT participate in this check — it's enforced only by local
  `git add`, not by the GitHub Contents/GraphQL APIs. Net: media
  binaries do accumulate in git; the GHA deploy `--exclude`s `data/*`
  from the S3 sync (S3 is canonical for binaries) so they sit
  harmlessly. A periodic `git rm packages/website/public/data/*`
  sweep cleans them up.
- Sveltia's S3 prefix is global (one prefix per media library). The
  flat `/data/*` URL space means every CMS upload lands in one bucket
  of media. Per-field routing isn't supported by Sveltia.

Upload widgets must be declared `widget: image` or `widget: file` in
`config.yml` — `widget: string` looks similar in the editor but has no
file picker.

Limitations (v1):
- Replacing an existing file with the same name shows stale content on
  the public site until CloudFront's CachingOptimized TTL (24h
  default) expires. Re-using filenames is therefore best avoided —
  prefer a new filename each upload.

### Deploying CMS frontend changes (config.yml, auth/, loader)

The CMS frontend lives in `packages/website/public/cms/`. To deploy
changes to it, the only safe path is the same as for the rest of the
site: **commit and push to `main`**, let the `deploy-website` GHA
workflow rebuild and sync. Or run `make frontend-deploy` locally for
the equivalent flow without a commit.

Do **NOT** surgically upload uncommitted state with `aws s3 cp` to
`s3://.../cms/*`. The GHA workflow runs `aws s3 sync dist/ --delete`
on every push to `main`, including pushes that don't touch CMS files;
its build of `dist/cms/*` reflects whatever is in `main` AT THAT
MOMENT, and that build will overwrite any surgical upload that
diverges from main. This race bit us during Plan 9 smoke testing: a
surgical upload of working-tree CMS changes was clobbered by the GHA
that ran in response to an unrelated commit on main.

## Multi-writer workflow

`packages/website/public/` is the source of truth for site binaries and lives canonically in S3.
When several contributors edit content from different machines:

1. `make frontend-pull` — sync any changes others have pushed since your last sync.
2. Edit `packages/website/public/` locally (add/replace PDFs, data files, photos).
3. `make frontend-deploy` — build, push `packages/website/public/` to S3, invalidate CloudFront.

Always pull before editing. `make frontend-pull` uses `aws s3 sync`'s default mtime
comparison, so it correctly downloads anything newer on S3 without overwriting
unchanged local files.

**Conflict semantics**: last-writer-wins on S3. **Object versioning is intentionally
not enabled** — see the spec's "Deployment infrastructure" note. Enable
`aws_s3_bucket_versioning` in `packages/infrastructure/s3.tf` if accidental overwrites or
multi-writer concurrency become a real problem; it gives free rollback at the
cost of storing every superseded version.

## SEO

Every page renders a full meta-tag stack from `packages/website/src/layouts/BaseLayout.astro`:
description, keywords, author, canonical URL, `hreflang` alternates (FR↔EN
where both versions exist), Open Graph tags, and Twitter card tags. A
generated `robots.txt` (from `packages/website/src/pages/robots.txt.js`) and a sitemap
(`sitemap-index.xml` + chunks, via `@astrojs/sitemap`) are emitted at build
time and uploaded to S3 by `make frontend-deploy`.

**Page-level overrides (optional, in markdown frontmatter):**

```yaml
---
title: "Page title"
locale: fr
slug: ...
description: "Specific meta description for this page."
keywords: "narrow, page-specific, keyword, list"
---
```

If `description` or `keywords` is omitted, the locale-wide defaults from
`packages/website/content/i18n/{fr,en}.json` (`site.description`, `site.keywords`) are used.
Override only when a page benefits from a narrower / more specific snippet —
most pages can rely on the defaults.

`hreflang` alternates are auto-suppressed for pages without a translation
(e.g. `/bureau/` is FR-only and emits only `hreflang="fr"` plus `x-default`).

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

## GEO

GEO (Generative Engine Optimization) makes the site a well-understood, citable
entity for AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Claude,
Gemini). It is markup-only — nothing here changes what human visitors see.

- **AI crawlers** — `packages/website/src/pages/robots.txt.js` explicitly
  welcomes the major AI agents (GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended, CCBot, …) in addition to the `User-agent: *` wildcard. The
  "allow everything" decision is intentional; edit the `AI_AGENTS` list to
  adjust.
- **`/llms.txt`** — `packages/website/src/pages/llms.txt.js` generates a curated
  Markdown map of the site (bio, FR + EN pages, books, external profiles) at
  build time from `packages/website/content/identity.json` and the `pages`
  collection. It never needs manual upkeep; new pages and books appear
  automatically on rebuild.
- **Entity graph** — the `Person` node carries a stable `@id` of
  `${site}#person` (`personId()` in `packages/website/src/lib/schema.mjs`).
  `bookSchema` and `publicationSchema` link Brigitte's authorship
  (`startsWith('Le Roux')`) to that `@id` instead of an anonymous author;
  `websiteSchema` declares her as the site's `author`/`about`. JSON-LD
  consumers merge these by `@id` across the separate `<script>` tags each
  layout emits.
- **Person facts** — `description` and `knowsAbout` (FR/EN) live in
  `packages/website/content/identity.json`, validated in
  `packages/website/src/lib/identity.mjs`, and surface in the Person JSON-LD
  per locale.

Deferred (future spec): a visible FAQ / definition blocks and the `FAQPage`
JSON-LD that legitimately requires visible Q&A; an `/llms-full.txt` full-text
dump.

## CloudFront access logs

Both CloudFront distributions emit standard-logging-**v2** access logs as
Parquet into one dedicated bucket, `brigitte-le-roux-website-cloudfront-logs-<account-id>`,
separated by prefix:

- `site` distribution (`brigitte-le-roux.com`)     → `raw/site/year=YYYY/month=MM/day=DD/`
- `cms` distribution (`cms.brigitte-le-roux.com`) → `raw/cms/year=YYYY/month=MM/day=DD/`

Both pipelines are Hive-date-partitioned under their prefix via
`s3_delivery_configuration` (`suffix_path = "{yyyy}/{MM}/{dd}"`,
`enable_hive_compatible_path = true`), so the Parquet stays partition-aware
for any later query layer.

Observe-only — purpose is security/abuse investigation and light analytics
(client IP, country, ASN, path, status, UA — the 14-field set). No WAF/blocking,
no query layer, no dashboard (all deliberately out of scope; the Parquet stays
queryable later if wanted). A whole-bucket lifecycle rule auto-deletes objects
after 90 days.

Terraform: the bucket + its delivery-write policy live in
`packages/infrastructure/s3.tf`; the six delivery resources (2× source /
destination / delivery, one pipeline per distribution) live in
`packages/infrastructure/logs.tf`. All delivery resources run in `us-east-1`
(CloudFront Delivery API requirement) even though the bucket is in
`eu-central-1`. Record fields are defined once in the `cloudfront_log_fields`
local — adding a field is a one-line change there.

**Gotcha:** delivery fails *silently* (AccessDenied, nothing surfaced on the
distribution) if the bucket policy's `aws:SourceAccount` / `aws:SourceArn` /
`s3:x-amz-acl` conditions or `Resource` are wrong. After any change, verify
Parquet objects actually appear under both prefixes within ~15 min of traffic.

## Build & deploy

```bash
yarn --cwd packages/website install
make frontend-dev       # http://localhost:4321
make frontend-build     # → packages/website/dist/
make frontend-pull      # sync packages/website/public/ from S3
make frontend-deploy    # build + S3 sync + CloudFront invalidation
make infra-plan         # terraform plan
make infra-apply        # terraform apply
```

Root convenience targets live in the top-level `Makefile` (there is no
root `package.json` — each package carries its own). Targets mirror the
former npm script names with `:` replaced by `-`.

Infra is Terraform under `packages/infrastructure/`. Remote state lives at
`s3://global-tf-states/brigitte-le-roux-website/terraform.tfstate` (region `eu-central-1`,
S3-native locking via `use_lockfile = true`). Route 53 hosted zone
`Z10238282ED2UHGM8STZA` and the ACM cert for `brigitte-le-roux.com` (in `us-east-1`) are
pre-existing and looked up via data sources — Terraform does not manage them.

## Deferred / out of scope

- Real publications search / filter (current listing is static).
- Light/dark theme toggle, PWA, analytics, forms.

## Reference

- Design spec: `docs/superpowers/specs/2026-05-16-brigitte-leroux-website-design.md`.
