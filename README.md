# brigitte-le-roux.com

Personal academic site for Brigitte Le Roux — researcher in Geometric Data
Analysis at MAP5 (Université Paris Cité) and CEVIPOF / CNRS. Bilingual
(French default, English at `/en/...`). Static Astro build served from S3 +
CloudFront at `https://brigitte-le-roux.com/`. Editor self-service via a
Sveltia CMS at `https://cms.brigitte-le-roux.com/`.

## Layout

```
brigitte-leroux-website/
├── package.json                       # root — scripts only, no deps
├── packages/
│   ├── website/                       # Astro 5 static site
│   │   ├── content/
│   │   │   ├── pages/                 # markdown content (flat per-locale layout)
│   │   │   │   ├── <slug>.{fr,en}.md          # e.g. cv.fr.md ↔ /cv/
│   │   │   │   └── <parent>/<slug>.{fr,en}.md # e.g. livres/cigda.fr.md ↔ /livres/cigda/
│   │   │   └── i18n/{fr,en}.json      # nav labels + UI strings
│   │   ├── src/                       # Astro components, layouts, routes, styles
│   │   ├── public/                    # static assets (mostly gitignored)
│   │   │   ├── cms/                   # Sveltia frontend (git-tracked — carve-out)
│   │   │   ├── pdfs/ data/ img/       # binaries (gitignored; S3 canonical)
│   │   │   └── favicon.{svg,ico}      # tracked
│   │   └── scripts/                   # deploy.sh, pull-public.sh
│   ├── functions/                     # AWS Lambdas (Node.js 22, arm64)
│   │   ├── github-gateway/            # Cognito-authenticated proxy to GitHub
│   │   └── media-manager/             # Issues S3 upload creds (LWA + Hono)
│   └── infrastructure/                # Terraform (S3, CloudFront, Cognito, API GW)
├── docs/superpowers/
│   ├── specs/                         # design specs
│   └── plans/                         # implementation plans (one per shipped slice)
├── CLAUDE.md                          # detailed engineering notes
└── .github/workflows/                 # deploy-website.yml (Actions auto-deploy)
```

## Architecture in one diagram

```
editor                                        public visitor
  │                                                │
  ▼                                                ▼
cms.brigitte-le-roux.com/cms/                  brigitte-le-roux.com
  │  Sveltia SPA (S3, served via CloudFront)     │  static HTML/CSS/JS
  │  Cognito SRP login via OAuth shim            │  served via CloudFront
  ▼                                                ▲
/api/git/*  →  github-gateway Lambda             │
                  │ JWT-auth + path allowlist     │
                  ▼                               │
              GitHub repo (main branch)           │
                  │ push                          │
                  ▼                               │
              GitHub Actions deploy-website.yml ──┘
                  │ Astro build + S3 sync + CF invalidate
```

## Install & run

```bash
yarn --cwd packages/website install        # one-time, in the Astro package

yarn frontend:dev                          # dev server on http://localhost:4321
yarn frontend:build                        # → packages/website/dist/
yarn frontend:pull                         # sync public/{pdfs,data,img} down from S3
yarn frontend:deploy                       # build + S3 sync + CloudFront invalidate

yarn backend:build                         # build Lambda ZIPs (esbuild + zip)
yarn backend:deploy                        # backend:build + terraform apply

yarn infra:plan                            # terraform plan
yarn infra:apply                           # terraform apply
```

All scripts delegate to per-package commands via `yarn --cwd` and
`terraform -chdir` — there are no yarn workspaces; each package has its
own `package.json` with strict-pinned deps.

## Editing content

### Routine edits — via the CMS (recommended)

1. Open `https://cms.brigitte-le-roux.com/`.
2. Sign in with your Cognito credentials.
3. Pick a collection in the sidebar:
   - **Pages** — narrative pages (cv, recherches, ateliers, these, logiciels, bureau)
   - **Page d'accueil** — homepage (FR / EN)
   - **Livres** — books listing + side sections
   - **Publications** — publications listing + communications
4. Edit form fields, click **Save**. Sveltia commits via the
   github-gateway Lambda; GitHub Actions rebuilds the site within ~2 min.

### Direct file editing — for admin tasks

The Astro content collection lives at `packages/website/content/pages/`.
Each page is a markdown file per locale. The naming convention is
**flat**: `<slug>.<locale>.md` for top-level pages, with detail pages one
folder deeper.

Frontmatter shape:

```yaml
---
title: "Page title"
locale: fr                          # or 'en'
slug: cv
description: "Optional SEO description"
keywords: "optional, seo, keywords"
category: narrative                 # set on narrative pages — controls
                                    # Sveltia auto-discovery
page_layout: home | books | publications  # optional — chooses a special layout
---
```

The `category: narrative` marker is what Sveltia's Folder collection
filters on, so adding the field makes the page show up in the CMS
automatically. The structured listing pages (home / livres / publications)
deliberately omit `category` because they have their own dedicated File
collections with rich form fields.

URL mapping is direct:

- `pages/cv.fr.md` ↔ `/cv/` (and `/en/cv/` for `cv.en.md`)
- `pages/livres.fr.md` ↔ `/livres/`
- `pages/livres/cigda.fr.md` ↔ `/livres/cigda/`

## Adding a new narrative page (admin)

1. Create `packages/website/content/pages/<new-slug>.fr.md` (+ `.en.md` if bilingual).
   Include `category: narrative` in each file's frontmatter.
2. Add the slug + label to `packages/website/content/i18n/{fr,en}.json`.
3. Add the route to the `items` array in
   `packages/website/src/components/Header.astro`.
4. Commit + push to `main`. GitHub Actions deploys.

The editor sees the new page in Sveltia's "Pages" collection on next
reload — no Sveltia config change needed.

## Adding a book or publication

Open `packages/website/content/pages/livres.{fr,en}.md` (books) or
`publications.{fr,en}.md` and append an entry to the inline `books:` /
`publications:` array. Both locale files need the entry. The CMS does
this via forms; direct YAML editing also works.

Schemas are in `packages/website/src/content/config.mjs`. The catch-all
routes sort by `year` descending at build time — no manual ordering needed.

## Static assets

`packages/website/public/` contains binaries served at URL root:

- `public/pdfs/` → `/pdfs/foo.pdf`
- `public/data/` → `/data/bar.xls`
- `public/img/`  → `/img/photo.jpg`

These three subdirectories are **gitignored** — S3 is the canonical store
(some files exceed GitHub's 100 MB per-file limit). To repopulate locally:

```bash
yarn frontend:pull                  # sync all three subtrees
yarn frontend:pull pdfs             # restrict to one subtree
yarn frontend:pull --delete         # also delete files no longer in S3
```

The Sveltia CMS frontend (`public/cms/`) IS tracked in git, because it's
CODE rather than media — see `CLAUDE.md` for details.

## Infrastructure

Terraform under `packages/infrastructure/`. Two CloudFront distributions:

- **Public site** at `brigitte-le-roux.com` — serves Astro build output from S3.
- **CMS** at `cms.brigitte-le-roux.com` — serves Sveltia from S3 + reverse-proxies `/api/*` to API Gateway.

Plus Cognito (single editor user, SRP login), HTTP API Gateway with
JWT authorizer routing to two Lambdas, Route 53 records, IAM roles +
policies, S3 bucket + bucket policies.

Remote Terraform state:
`s3://global-tf-states/brigitte-le-roux-website/terraform.tfstate`
(region `eu-central-1`, S3-native locking). Route 53 hosted zone and
ACM certificates (`brigitte-le-roux.com` + `cms.brigitte-le-roux.com`)
are pre-existing and looked up via data sources.

## CI/CD

- **`.github/workflows/deploy-website.yml`** — triggers on push to `main`
  when paths under `packages/website/**` change. Builds Astro, syncs to
  S3, invalidates CloudFront. Uses OIDC to assume an AWS role; no
  long-lived credentials in GitHub.
- **Lambdas + infrastructure** — deployed locally by the admin via
  `yarn backend:deploy` and `yarn infra:apply`. Not in CI by design;
  the editor never triggers infra changes.

## Reference

- Design specs: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
- Detailed engineering notes: `CLAUDE.md`
