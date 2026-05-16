# brigitte-le-roux.com

Personal academic site for Brigitte Le Roux — researcher in Geometric Data Analysis at
MAP5 (Université Paris Cité) and CEVIPOF/CNRS. Bilingual (French / English), static
Astro build served from S3 + CloudFront at `https://brigitte-le-roux.com/`.

## Layout

```
brigitte-leroux-website/
├── src/                        # Astro project (components, layouts, pages, styles)
├── content/                    # text source — pages, listings, i18n strings
│   ├── pages/<slug>/{fr,en}.md
│   ├── data/{publications,books,reviews}.json
│   └── i18n/{fr,en}.json
├── public/                     # binaries served verbatim at URL root
│   ├── pdfs/   (~30 MB)        # publication PDFs
│   ├── data/   (~217 MB)       # downloadable datasets / scripts
│   └── img/    (~52 KB)        # photos
├── infrastructure/             # Terraform (S3 + CloudFront + Route 53)
├── scripts/deploy.sh           # build + S3 sync + CloudFront invalidation
├── docs/superpowers/specs/     # design spec
├── CLAUDE.md                   # project-specific notes for Claude Code
└── package.json
```

## Install & run

```bash
yarn install
yarn dev                        # http://localhost:4321
yarn build                      # → dist/
yarn preview                    # serve dist/ locally
```

## Adding a content page

1. Create `content/pages/<new-slug>/fr.md` (and `en.md` for the English translation):

   ```yaml
   ---
   title: "Page title"
   locale: fr                   # or en
   slug: new-slug
   description: "Optional meta description"
   listing: books               # optional — 'books' or 'publications' renders a
                                # JSON-driven listing below the markdown body
   ---
   ```

2. If the page should appear in the header nav, add its slug and label to
   `content/i18n/fr.json` and `content/i18n/en.json`, then add the route to the
   `items` array in `src/components/Header.astro`.

## Deploy

```bash
# One-time infrastructure
cd infrastructure
terraform init
terraform apply

# Each release
yarn deploy                     # build → s3 sync → CloudFront invalidation
```

Terraform state is remote (`s3://global-tf-states/brigitte-le-roux-website/terraform.tfstate`).
Route 53 hosted zone and the ACM certificate for `brigitte-le-roux.com` are pre-existing
and looked up via data sources.

## Reference

- Design spec: `docs/superpowers/specs/2026-05-16-brigitte-leroux-website-design.md`
- Project notes for Claude Code: `CLAUDE.md`
