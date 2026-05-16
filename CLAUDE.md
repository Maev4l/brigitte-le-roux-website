# brigitte-le-roux.com

Personal academic site for Brigitte Le Roux (mathematician, MAP5 / CEVIPOF–CNRS).
Bilingual (FR default, EN at `/en/...`). Static Astro build deployed to S3 +
CloudFront on `brigitte-le-roux.com`.

## Stack

- Astro 5 (static output), Yarn, strict version pinning, no TypeScript, no workspaces.
- Single Astro project at the repo root. Dev server on port `4321`.
- Theme tokens in `src/styles/theme.css` — Fraunces (display), Bricolage Grotesque (UI),
  vermillion kicker on parchment ground.

## Content model

- **Pages**: `content/pages/<slug>/{fr,en}.md` with frontmatter
  (`title`, `locale`, `slug`, optional `description`, optional `listing: books|publications`).
- **Listings**: `content/data/{publications,books,reviews}.json` — imported by the
  catch-all route components.
- **i18n**: `content/i18n/{fr,en}.json` for nav labels, footer text, common UI strings.

Adding a new route:

1. Create the markdown pair in `content/pages/<new-slug>/`.
2. Add the slug + label to `content/i18n/{fr,en}.json`.
3. Add the route to the `items` array in `src/components/Header.astro`.

## Static assets

`public/` contains binaries served verbatim at URL root:

- `public/pdfs/` → `/pdfs/foo.pdf`
- `public/data/` → `/data/bar.xls`
- `public/img/`  → `/img/photoweb.jpg`

All three are **tracked in git** (~247 MB total). They are the only copy; do not
gitignore. Reference them from markdown/JSON as plain absolute paths (e.g.
`[PDF](/pdfs/foo.pdf)`).

## Build & deploy

```bash
yarn install
yarn dev                # http://localhost:4321
yarn build              # → dist/
yarn deploy             # build + S3 sync + CloudFront invalidation
yarn infra:plan         # terraform plan
yarn infra:apply        # terraform apply
```

Infra is Terraform under `infrastructure/`. Remote state lives at
`s3://global-tf-states/brigitte-le-roux-website/terraform.tfstate` (region `eu-central-1`,
S3-native locking via `use_lockfile = true`). Route 53 hosted zone
`Z10238282ED2UHGM8STZA` and the ACM cert for `brigitte-le-roux.com` (in `us-east-1`) are
pre-existing and looked up via data sources — Terraform does not manage them.

## Deferred / out of scope

- Real publications search / filter (current listing is static).
- Light/dark theme toggle, PWA, analytics, forms.

## Open follow-ups

- `bureau` page is FR-only on the legacy source; currently omitted from EN nav.
- Publications JSON schema may evolve once the listing UX is finalized.
- Translated FR/EN slug pairs to be verified against the legacy site nav.

## Reference

- Design spec: `docs/superpowers/specs/2026-05-16-brigitte-leroux-website-design.md`.
