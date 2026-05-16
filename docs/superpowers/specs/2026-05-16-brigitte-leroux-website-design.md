# Spec — brigitte-le-roux.com

**Date:** 2026-05-16

## Background

Brigitte Le Roux is a researcher in mathematics (Geometric Data Analysis, Multiple
Correspondence Analysis) affiliated with MAP5 (Université Paris Cité) and CEVIPOF/CNRS.
The legacy site at `https://helios2.mi.parisdescartes.fr/~lerb/` is a bilingual (FR/EN)
static HTML site. This repo is its modernization, deployed at
`https://brigitte-le-roux.com/`.

## Goals

1. Ship a modernized bilingual personal academic site at `https://brigitte-le-roux.com/`.
2. Preserve the bilingual structure (FR default, EN at `/en/...`).
3. Keep the output plain static HTML deployable to S3 / CloudFront.
4. Single source of truth for text content (`content/`) and binaries (`public/`).

## Non-goals

- Real publications search / filter — static listing for now.
- Light/dark theme toggle.
- Forms, analytics, service worker, PWA.

## Constraints

- **Output**: plain static HTML, no SPA, no client-side routing.
- **Default language**: French. English at prefixed URLs (`/en/...`).
- **Package management**: Yarn, strict version pinning.
- **No TypeScript**, no Yarn workspaces.
- **Date library**: `dayjs` if needed (not `moment`).
- **Fixed dev port** for Vite/Astro server.

## Architecture

### Repo layout

```
brigitte-leroux-website/
├── package.json                # name: brigitte-leroux-website
├── astro.config.mjs            # base: '/'; publicDir default
├── src/
│   ├── components/             # Header, Footer, LanguagePicker
│   ├── content/config.mjs      # glob loader, base './content/pages'
│   ├── layouts/                # BaseLayout, PageLayout
│   ├── pages/                  # [...slug].astro + en/[...slug].astro
│   └── styles/theme.css        # Fraunces + vermillion + parchment
├── content/                    # text source (processed)
│   ├── pages/<slug>/{fr,en}.md
│   ├── data/{publications,books,reviews}.json
│   └── i18n/{fr,en}.json
├── public/                     # binaries served verbatim at URL root
│   ├── pdfs/                   # ~30 MB — tracked
│   ├── data/                   # ~217 MB — tracked
│   └── img/                    # ~52 KB — tracked
├── infrastructure/             # Terraform (S3 + CloudFront + Route 53)
├── scripts/deploy.sh           # build + sync to S3 + invalidate CloudFront
├── docs/superpowers/specs/     # this file
├── .superpowers/               # session caches (gitignored)
├── .claude/
├── .gitignore
├── CLAUDE.md
└── README.md
```

Note: `content/data/` (JSON listings, code-imported) and `public/data/` (XLS/SPAD/R/SAV
downloads served at `/data/`) share a name but never collide — one is a filesystem
import path, the other is a URL path.

### Content model

- **Pages** — `content/pages/<slug>/{fr,en}.md` with frontmatter:
  ```yaml
  ---
  title: "Page title"
  locale: fr            # or en
  slug: <slug>
  description: "Optional meta description"
  listing: books        # optional: 'books' or 'publications' renders a JSON-driven section
  ---
  ```
- **Listings** — `content/data/{publications,books,reviews}.json`, imported by the
  catch-all route components.
- **i18n strings** — `content/i18n/{fr,en}.json` for nav labels, footer text, common UI.

### Routing

Astro built-in i18n: `defaultLocale: 'fr'`, `locales: ['fr', 'en']`,
`prefixDefaultLocale: false`. French at `/`, English at `/en/...`. Translated slug pairs
preserved from the legacy site (e.g. `livres` ↔ `books`, `logiciels` ↔ `software`).
`<LanguagePicker>` in the header links to the equivalent URL in the other language.

### Static assets

`public/` contains binaries served verbatim at URL root:

| Folder | URL | Size | Tracked? |
|---|---|---|---|
| `public/pdfs/` | `/pdfs/foo.pdf` | ~30 MB | yes |
| `public/data/` | `/data/bar.xls` | ~217 MB | yes |
| `public/img/`  | `/img/photoweb.jpg` | ~52 KB | yes |

`public/` is the canonical copy of these binaries. ~247 MB tracked in git is
acceptable for a seldom-cloned single-author repo; Git LFS not used.

### Build & dev

- **Astro 5** as the SSG.
- Single `package.json` at the repo root, no workspaces.
- Astro dev server on port **4321**.
- `astro.config.mjs` is minimal — `site`, `i18n` config, `server.port`,
  `build.format: 'directory'`. Site is served at the root path so `base` defaults to `/`.

Package scripts:

```json
{
  "scripts": {
    "dev":         "astro dev --port 4321",
    "build":       "astro build",
    "preview":     "astro preview --port 4321",
    "deploy":      "bash scripts/deploy.sh",
    "infra:plan":  "terraform -chdir=infrastructure plan",
    "infra:apply": "terraform -chdir=infrastructure apply -auto-approve"
  }
}
```

### Deployment infrastructure

- **Domain**: `brigitte-le-roux.com`.
- **Route 53 hosted zone**: pre-existing, id `Z10238282ED2UHGM8STZA`.
- **ACM certificates**: pre-existing in both `us-east-1` (used by CloudFront) and
  `eu-central-1` (not consumed by this infra; available for future ALB / API Gateway).
- **Terraform state**: remote, `s3://global-tf-states/brigitte-le-roux-website/terraform.tfstate`,
  region `eu-central-1`, `use_lockfile = true`.

Resources provisioned:

- **S3 bucket** `brigitte-le-roux-website` (region `eu-central-1`, `force_destroy = true`).
  Public access blocked; bucket policy grants read only to the CloudFront distribution
  via the OAC `AWS:SourceArn` condition.
- **CloudFront distribution** — origin is the S3 bucket via Origin Access Control (OAC).
  Default root object `index.html`. Cache policy: **CachingOptimized**
  (`658327ea-f89d-4fab-a63d-7e88639e58f6`). Deploys invalidate `/*` so freshness is
  guaranteed.
- **CloudFront Function** (viewer-request) — rewrites `/` and extension-less URIs to
  `<uri>/index.html`. Required because S3's REST origin doesn't serve directory index
  documents natively.
- **ACM certificate** — looked up via data source on `var.domain_name` in `us-east-1`.
- **Route 53 records** — A/AAAA aliases on `brigitte-le-roux.com` pointing at the
  CloudFront distribution, using `var.hosted_zone_id` directly (no zone lookup).

Deploy workflow:

```bash
cd infrastructure && terraform init && terraform apply   # one-time
yarn deploy                                              # build + sync + invalidate
```

`scripts/deploy.sh`:
1. Reads bucket name and distribution ID from `terraform output`.
2. `yarn build`.
3. `aws s3 sync dist/ s3://<bucket>/ --delete --size-only`.
4. `aws cloudfront create-invalidation --paths "/*"`.

## Out of scope

- Real publications search / filter.
- Light/dark theme toggle, PWA, analytics, forms.

## Open questions

- **`bureau` under `/en/`**: source is FR-only on the legacy site. Default behaviour:
  omit from EN nav, no `/en/bureau` route. Confirm.
- **Publications JSON schema**: exact citation format and optional fields — finalize
  alongside any listing-UX work.
- **Translated slug map**: verify the FR/EN slug pairs by walking the legacy site's nav
  once during implementation.
