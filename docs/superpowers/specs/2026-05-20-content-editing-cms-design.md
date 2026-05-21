# Autonomous content editing for brigitte-le-roux.com — design

**Date**: 2026-05-20
**Status**: design — pending implementation plan

## Problem

Brigitte Le Roux (the site's subject and primary editor) is not technically
inclined. Her authoring background is Dreamweaver: she expects to open
something, edit content visually, click a publish button, and see the result.

The current site (Astro 5 static build, deployed via `yarn deploy` from the administrator's
laptop) requires git, Node, Yarn, AWS credentials, and editing markdown +
YAML by hand. None of that is realistic for Brigitte. Today she cannot update
the site autonomously; every edit has to flow through the administrator.

This spec describes an end-to-end editing experience that lets her log in to
a browser admin, edit forms and rich text, upload PDFs and photos, and have
the site update within a couple of minutes — with no terminal, no git, and
no AWS knowledge on her side.

## Decisions (settled during brainstorming)

| Topic | Decision |
| --- | --- |
| Editing surface | Web browser; CMS at `cms.brigitte-le-roux.com/` (Sveltia SPA hosted at `s3://brigitte-le-roux-website/cms/*`, served via a dedicated CloudFront distribution) |
| Publish behaviour | Auto-publish — every save reaches the live site within ~1–2 min |
| CMS | Sveltia CMS (modern, free, active fork of Decap; single static SPA, git-backed) |
| Editor auth | AWS Cognito (User Pool, email + password). Sveltia renders its own login form and calls Cognito directly via `amazon-cognito-identity-js` (USER_SRP_AUTH). No Hosted UI redirect — Brigitte stays on `cms.brigitte-le-roux.com` end-to-end. No GitHub account for Brigitte. |
| Repo / commit identity | GitHub App owned by the administrator; installed on the repo; Lambda mints short-lived installation tokens |
| GitHub repo visibility | Public |
| Media (PDF / image) storage | Direct browser → S3 via presigned URL signed by a Lambda. S3 stays canonical for binaries (matches today's invariant) |
| CI/CD scope | GitHub Actions deploys the website only. Functions + infrastructure are deployed locally by the administrator (`yarn backend:deploy`, `yarn infra:apply`) |
| Secret storage | SSM Parameter Store SecureString (default AWS-managed KMS). Lambda fetches at cold-start, caches in module scope |
| Lambda language | Node.js 22 (ESM, plain JavaScript, no TypeScript). ZIP package on AWS-managed Node 22 runtime, arm64/Graviton |
| Lambda naming | Deployed AWS Lambda function names prefixed `brigitte-le-roux-website-*` (e.g. `brigitte-le-roux-website-github-gateway`, `brigitte-le-roux-website-media-manager`). Local folder names stay short (no prefix). |
| Monorepo layout | `packages/website/`, `packages/infrastructure/` (flat), `packages/functions/` (created later when CMS work starts). No Yarn workspaces — root `package.json` only carries scripts |
| `text_html` fields (communications / book chapters / translated books) | Raw HTML / plain-text widget (no rich editor) to avoid round-trip drift on existing entries |

## High-level architecture

```
Brigitte's browser
  │
  │ 1. opens https://cms.brigitte-le-roux.com/
  ▼
Sveltia CMS (static SPA, served by CloudFront from S3 admin/ origin)
  │ renders its own login form ──► Cognito USER_SRP_AUTH (no redirect)
  │ stores tokens in localStorage
  │
  │ 2a. text save (Bearer JWT)            2b. ask upload URL (Bearer JWT)
  ▼                                        ▼
API Gateway HTTP API + JWT authorizer (Cognito)
  │                                        │
  ▼                                        ▼
Lambda: github-gateway                  Lambda: media-manager
  - reads JWT claims                       - reads JWT claims
  - path allowlist                         - validates name/type/size
  - rewrites commit author                 - signs S3 PUT URL
  - mints GitHub App install token         - triggers CloudFront invalidation
  - forwards to api.github.com
  │                                        │
  │ (SSM SecureString: App PEM)            │ (returns presigned URL)
  ▼                                        │
GitHub repo (public)                       │
  │ push triggers                          │
  ▼                                        │
GitHub Actions: yarn build → S3 sync → CF invalidate
  │                                        │
  ▼                                        ▼
S3 (HTML, CSS, JS, /cms/)  ◄────── direct browser PUT (PDF / images) ◄── Sveltia
  │
  ▼
CloudFront ─── public visitors
```

Notes on the diagram:

- The file itself never passes through the media-manager Lambda. The Lambda
  only signs the URL; the browser PUTs directly to S3.
- The github-gateway Lambda enforces the path allowlist on every commit Brigitte
  initiates. This is the *real* safety fence — CODEOWNERS only enforces
  reviews on PRs, but Sveltia commits go straight to `main`.
- A draw.io diagram will be authored separately later in the project.

## §0 — Monorepo refactor (must land first)

Today: single Astro project at the repo root, no workspaces. Project CLAUDE.md
explicitly stated *"no workspaces. Single Astro project at the repo root."*
This decision is being revised because the project will now have multiple
deployable units (website + Terraform + Lambdas).

Target layout:

```
brigitte-leroux-website/
├── package.json                ← scripts only — NO dependencies
├── packages/
│   ├── website/                ← Astro site (was repo root)
│   │   ├── package.json        ← all Astro deps stay here
│   │   ├── astro.config.mjs
│   │   ├── src/, content/, public/, scripts/
│   ├── infrastructure/         ← all .tf files in one flat folder
│   │   ├── main.tf, s3.tf, cloudfront.tf, dns.tf, …
│   │   └── (NEW: cognito.tf, api-gateway.tf, lambda-*.tf, ssm.tf, iam-gha.tf)
│   └── functions/              ← created later, when CMS work starts
│       ├── Makefile            ← orchestrates build / package for all functions
│       ├── github-gateway/        ← ZIP-packaged Lambda, Node 22 ESM
│       └── media-manager/     ← ZIP-packaged Lambda, Node 22 ESM
├── docs/                       ← stays at root
├── .github/workflows/          ← stays at root (single workflow for website deploy)
├── CLAUDE.md                   ← revised (drop "no workspaces", document new layout)
└── .gitignore
```

Root `package.json`:

```json
{
  "name": "brigitte-le-roux-website",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "frontend:dev":      "yarn --cwd packages/website dev",
    "frontend:build":    "yarn --cwd packages/website build",
    "frontend:pull":     "yarn --cwd packages/website pull",
    "frontend:deploy":   "yarn --cwd packages/website deploy",
    "backend:build":     "make -C packages/functions build",
    "backend:deploy":    "make -C packages/functions deploy && yarn infra:apply",
    "infra:plan":        "terraform -chdir=packages/infrastructure plan",
    "infra:apply":       "terraform -chdir=packages/infrastructure apply -auto-approve"
  }
}
```

Naming conventions follow the alexandria project style: namespaced (`frontend:*`,
`backend:*`, `infra:*`), `yarn --cwd` (no `cd && yarn`), `make -C`, `terraform -chdir`.

`packages/functions/` is created later — it does not exist after Section 0.
The Makefile and the per-function folders are produced when the CMS work
actually starts.

### Refactor steps (one commit)

1. `git mv` Astro source tree under `packages/website/` (preserves history).
2. `git mv infrastructure/ packages/infrastructure/` (preserves history).
3. Adjust paths in `pull-public.sh` and `deploy.sh` — they reference `public/`
   and `dist/`, both now under `packages/website/`. The scripts should
   continue to assume they run from `packages/website/`.
4. Move the Astro `package.json` into `packages/website/` unchanged
   (strict-pinned deps stay strict).
5. Create the slim root `package.json` above.
6. Update `CLAUDE.md`: drop the "no workspaces / single Astro project" line;
   document the new layout and namespaced scripts.
7. Verify all root scripts work: `yarn frontend:dev`, `yarn frontend:build`,
   `yarn frontend:deploy`, `yarn frontend:pull`, `yarn infra:plan`.

### Checkpoint after §0

After the refactor commits land, the administrator pauses to:

- Commit the refactor.
- Create the GitHub remote repo (public).
- Push.

Only after the remote exists and the GitHub repo is reachable does §1 work
begin.

## §1 — Sveltia CMS hosting

Sveltia is a static SPA. It is served from the website's own S3 bucket at
the path prefix `/cms/`. No separate hosting.

Files in the website package:

- `packages/website/public/cms/index.html` — pulls Sveltia from a pinned
  CDN URL (or a self-hosted copy in `public/cms/vendor/sveltia/`). Initial
  decision: CDN pin to a specific Sveltia version tag.
- `packages/website/public/cms/config.yml` — Sveltia collection
  configuration (§2).
- `packages/website/public/cms/sveltia-cognito-backend.js` — custom
  backend plugin (~80 lines) that wires Sveltia to Cognito + our github-gateway.
- `packages/website/public/cms/sveltia-s3-media.js` — custom media library
  plugin (~150 lines) that wires "Upload file" to our media-manager.

Both JS files are committed into the website repo (they are part of the
deployable artefact, not gitignored).

CloudFront serves `/cms/` from S3 same as the rest of the site. Routing
constraint: SPA-style refresh on `/cms/foo` should serve `/cms/index.html`.
The existing CloudFront function (`packages/infrastructure/cloudfront-function.js`
after §0) will be extended to handle this if it doesn't already.

## §2 — Content schemas mapped to Sveltia forms

Brigitte sees forms, never YAML. Each Sveltia collection mirrors the Zod
schema in `packages/website/src/content/config.mjs`. Sveltia validates on
save; if she somehow bypasses, the Zod build-time check fails and the
deploy doesn't ship — the site never breaks.

Five collections, all in French in the UI:

### 1. Narrative pages (Folder collection)

- Targets `packages/website/content/pages/<slug>/` for slugs:
  `cv`, `recherches`, `ateliers`, `these`, `logiciels`, `bureau`.
- `i18n: multiple_files`, locales `[fr, en]`, default `fr`. Sveltia treats
  `fr.md` + `en.md` as two locales of the same entry, with a tab switcher.
- Form fields:
  - `title` (string, required)
  - `description` (string, optional — narrower-than-default SEO snippet)
  - `keywords` (string, optional)
  - body (markdown widget with rich-text toolbar: bold, italic, headings,
    links, lists)

### 2. Home page (File collection, single entry)

Targets `packages/website/content/pages/home/{fr,en}.md`.

- `kicker` (string)
- `deck_html` (string, monospace, label: "Sous-titre (HTML)"; help text
  notes that `<br>`, `&nbsp;`, `<em>` are allowed)
- `portrait`: `{ src (file picker → S3), alt (string) }`
- `tiles`:
  - `affiliations`: `{ title, body_html, note }`
  - `methodes`: `{ title, items: [{ label, ab }] }` — repeatable list
  - `nouveau`: `{ title, book_title, book_href, book_meta }`

### 3. Books page (File collection)

Targets `packages/website/content/pages/livres/{fr,en}.md`.

- Top-level: `title`, `description`, `keywords`.
- `books`: repeatable list of book entries (slug, title, authors (string
  list), year (number), publisher, isbn, optional page_slug, optional
  external URL).
- Two review shapes supported (both already in the existing schema):
  - `book_review_url` (single URL, optional) — for CIGDA
  - `reviews` (repeatable: reviewer, venue, year, url with file picker → S3) — for GDA
- `translated_books_title` (string) + `translated_books` (repeatable
  `{ year, text_html }`).
- `book_chapters_title` + `book_chapters` (repeatable `{ slug, year, text_html }`).
- `data_sets_link_html` (string).

### 4. Publications page (File collection)

Targets `packages/website/content/pages/publications/{fr,en}.md`.

- Top-level: `title`, `description`, `keywords`.
- `publications`: repeatable list (slug, year, title, authors, venue,
  type (dropdown: article / book / chapter / slides), pages, pdf (file
  picker → S3), external URL).
- `communications_international_title` + `communications_international`
  (repeatable `{ year, text_html }`).
- `communications_national_title` + `communications_national` (same shape).

### 5. i18n strings — NOT exposed to Brigitte

`content/i18n/{fr,en}.json` are dev-only nav labels. The administrator maintains them in
code. The Sveltia config explicitly does not surface them.

### `text_html` widget choice

All `text_html` fields (communications, translated_books, book_chapters)
use a **raw HTML / plain-text widget**, not a rich editor. Reason:
existing entries are free HTML; a rich editor would normalize whitespace
and attribute order on save, silently mutating already-published content.
Plain-text matches Brigitte's Dreamweaver "Code" view comfort and gives
zero risk of round-trip drift.

### Year-descending sort

Already handled by the catch-all routes
(`packages/website/src/pages/[...slug].astro` and
`packages/website/src/pages/en/[...slug].astro`) — they sort `books` /
`publications` by `year` desc at build time. Brigitte does not need to
order her entries.

### Adding a new top-level route

Out of scope for Brigitte. Adding a new section requires updating the
header nav in `packages/website/src/components/Header.astro`, which is
path-protected by CODEOWNERS + the Lambda allowlist. The administrator
does this once when needed.

## §3 — Editor auth + github-gateway Lambda

### Cognito User Pool

Terraform: `packages/infrastructure/cognito.tf`.

- One User Pool: `brigitte-le-roux-website-cms`.
- Email as username.
- Password policy: minimum 12 characters, mixed case, includes at least
  one number.
- MFA: not configured at the pool level at launch (omitted from Terraform
  because `cognito-idp:SetUserPoolMfaConfig` is not in the day-to-day dev
  role). Admin can enable later via console if needed.
- Self-signup disabled — the administrator creates the user manually via
  the AWS console or via `aws cognito-idp admin-create-user`.
- One App Client (public, no client secret). `ALLOW_USER_SRP_AUTH` +
  `ALLOW_REFRESH_TOKEN_AUTH` enabled — the Sveltia plugin uses SRP for
  the in-app login (see "Custom Sveltia backend plugin" below). OAuth
  Authorization Code + PKCE is also configured (`callback_urls =
  https://cms.brigitte-le-roux.com/`) as a fallback in case we ever
  revert to Hosted UI; with the in-Sveltia approach those fields are
  unused.
- Hosted UI: Cognito-managed prefix domain `<prefix>.auth.<region>.amazoncognito.com`
  is created (it costs nothing and gives us the Hosted-UI fallback) but
  not normally surfaced to Brigitte. No custom domain on Cognito — the
  unified-subdomain architecture means everything Brigitte sees is on
  `cms.brigitte-le-roux.com`.
- Account recovery: `admin_only` — passwords are reset by the
  administrator (via console), not via self-service email. Acceptable
  for a single-editor site.

### API Gateway HTTP API

Created via `Maev4l/terraform-modules//modules/lambda-trigger-apigw` —
the module creates the HTTP API + JWT authorizer + integrations + routes
bundled with the first Lambda's trigger (Plan 4). No standalone
`api-gateway.tf` in this project.

- Single HTTP API, no custom domain. Routes are reachable both via the
  default `<api-id>.execute-api.<region>.amazonaws.com` URL AND
  (transparently) via `https://cms.brigitte-le-roux.com/api/*` once the
  CMS CloudFront distribution lands.
- One JWT authorizer wired to the Cognito User Pool, applied to all
  routes that require authentication.
- Routes (added when each Lambda trigger is wired up):
  - `POST/PUT/GET/DELETE /api/git/{proxy+}` → integrates with the `github-gateway` Lambda
  - `POST /api/media/upload-url` → integrates with the `media-manager` Lambda
- CORS configured by the module for `https://cms.brigitte-le-roux.com`
  (defensive — end-state is same-origin via CloudFront, so CORS preflight
  rarely fires).

### github-gateway Lambda

Location: `packages/functions/github-gateway/`.

- Runtime: Node.js 22 (or latest LTS Lambda supports at build time).
- Plain JavaScript ESM. `"type": "module"` in `package.json`. Fat-arrow
  notation throughout. ESLint via `eslint.config.js`.
- Strict version pinning in `package.json`.
- Packaging: ZIP. AWS-managed Node.js 22 runtime, `architecture = "arm64"`
  (Graviton). Source is bundled with **esbuild** (library mode, target
  `node22`, format ESM, `@aws-sdk/*` externalized — those are
  runtime-provided). The bundled `dist/index.mjs` (~180 KB) goes into
  the ZIP (~36 KB compressed). Terraform's `source_code_hash` is fed
  `filebase64sha256` of the **bundled file**, not the ZIP — ZIPs are
  non-deterministic (mtimes, file ordering) and would otherwise trigger
  spurious Lambda updates on every apply.
- Uses the `Maev4l/terraform-modules//modules/lambda-function` module
  (v1.7.1 pinned) for the Lambda resource + IAM execution role +
  CloudWatch log group. The HTTP API + JWT authorizer + integration +
  route are bundled in the same project via
  `Maev4l/terraform-modules//modules/lambda-trigger-apigw` (v1.7.1).
- Dependencies (production):
  - `@octokit/rest`
  - `@octokit/auth-app`
  - `@aws-sdk/client-ssm`
- `@aws-sdk/*` modules are listed as dependencies for local development
  + bundler resolution, but esbuild marks them `external` so the deployed
  bundle uses the AWS-managed Node.js 22 runtime's pinned versions
  instead of inlining them.

#### Configuration (env vars)

- `ALLOWED_REPO` — `Maev4l/brigitte-le-roux-website`.
- `GITHUB_APP_SECRETS_PARAM` — SSM parameter name where the GitHub App
  credentials JSON lives (e.g. `brigitte-le-roux-website.github-app-secrets`).

No env vars carry the App ID, Installation ID, or PEM directly — all
three live in the single SSM SecureString parameter and the Lambda
reads + parses them at cold start. This keeps GitHub App credentials
out of Terraform state and out of the Lambda config visible in the AWS
console.

The path allowlist is hardcoded in `lib/allowlist.mjs` rather than
passed via env (no need to make it dynamic — changes require a code
review anyway).

#### SSM Parameter Store

- **Single SSM SecureString** at `brigitte-le-roux-website.github-app-secrets`,
  type `SecureString`, default AWS-managed KMS key (`aws/ssm`). Contains
  JSON:
  ```json
  {
    "app_id": "3796411",
    "installation_id": "134363513",
    "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
  }
  ```
- NOT managed by Terraform — created and updated manually via
  `aws ssm put-parameter` (the value depends on the GitHub App + PEM
  that the administrator generates interactively on github.com, so
  Terraform-managed creation would require non-Terraform-tracked
  variables anyway).
- Lambda IAM role has `ssm:GetParameter` on this specific ARN only,
  plus `kms:Decrypt` on `aws/ssm`. Nothing wider.
- Lambda reads + parses the JSON at module load (cold start), caches
  the resulting Octokit instance in module scope. Warm invocations skip
  the SSM call.
- Rotation procedure (PEM regeneration): regenerate the PEM on the
  GitHub App settings page → `aws ssm put-parameter ... --overwrite`
  with a new JSON containing the new private_key → force a Lambda
  redeploy so a fresh container picks up the new value at cold start.

#### Per-request behaviour

1. API Gateway has already verified the Cognito JWT before invoking the
   Lambda — Lambda reads the verified claims from
   `event.requestContext.authorizer.jwt.claims`.
2. Repo lock: reject any request whose path doesn't match `ALLOWED_REPO`.
3. Path allowlist: for commit-creating calls, inspect the file paths in
   the request body; reject (403) if any path falls outside the hardcoded
   allowlist (`packages/website/content/` is the only entry today, in
   `lib/allowlist.mjs`). This is the primary safety fence — see §5 / §6.
4. Commit-author rewrite: inject the Cognito user's email into
   `author.name` + `author.email` so `git log` attributes the commit to
   Brigitte even though the GitHub App is the committer.
5. Authenticate to GitHub via Octokit + `createAppAuth`. The library mints
   a JWT signed with the App PEM, exchanges it for a 1-hour installation
   token, caches it, and refreshes automatically.
6. Forward the request to `api.github.com` via Octokit. Stream the
   response back to the client.

#### GitHub App

- Owned by the administrator's personal GitHub account. Free.
- Installed on the (public) repo only — no organization-wide install.
- Permissions (minimum): `contents: write`, `pull_requests: write`,
  `metadata: read`. Nothing else.
- Private key downloaded once (PEM) and uploaded to SSM SecureString.
  Original PEM file is destroyed locally afterwards.
- Key rotation runbook documented (§6). Quarterly cadence.

### Custom Sveltia backend plugin

`packages/website/public/cms/sveltia-cognito-backend.js`. ~250 lines of JS.

The plugin replaces Sveltia's OAuth-redirect flow with an in-app login
form that talks to Cognito directly via `amazon-cognito-identity-js`.
Brigitte never sees the AWS-managed `amazoncognito.com` URL — the entire
auth UX stays on `cms.brigitte-le-roux.com`.

- **Login form**: HTML form (email + password) rendered when no valid
  refresh token is found in `localStorage`. Branded with the site's
  vermillion/parchment styling.
- **Authentication**: `CognitoUserPool.authenticateUser` with `USER_SRP_AUTH`.
  The SDK handles the SRP cryptographic exchange; the password never
  leaves the browser in plaintext.
- **Token storage**: `localStorage` keys for access token (1 h TTL),
  id token (1 h TTL), refresh token (365 d TTL — set in Plan 3's
  Cognito App Client).
- **Silent refresh**: when the access token approaches expiry, the
  plugin calls `CognitoUser.refreshSession()` using the refresh token,
  swaps in the new access + id tokens. Transparent to the editor.
- **API call wiring**: the plugin overrides Sveltia's `api_root` to
  `/api/git` (relative — same-origin under `cms.brigitte-le-roux.com`).
  Every outbound request gets `Authorization: Bearer <id_token>` (the
  id_token is what API Gateway's JWT authorizer validates).
- **Logout**: clears `localStorage`, re-renders the login form.

**No Hosted UI, no OAuth Authorization Code flow, no redirect bounce.**
The Cognito App Client's OAuth-related fields (`callback_urls`,
`allowed_oauth_flows`, `allowed_oauth_scopes`) configured in Plan 3 are
unused by this plugin but kept as a fallback option in case we ever want
to revert to the Hosted UI flow.

Bundle-size impact: `amazon-cognito-identity-js` adds ~150 KB gzipped
(or ~50 KB if we use the modular `@aws-sdk/client-cognito-identity-provider`
with tree-shaking). Acceptable for a CMS UI.

**Trade-offs accepted**: no built-in MFA UI (would need ~40 extra lines
to render a TOTP prompt when MFA is enabled — deferred until/unless MFA
is turned on), no built-in self-service password reset (admin resets
passwords via console — acceptable for a single-editor site), no built-in
account-lockout UX (Cognito still enforces lockout server-side; the
plugin just surfaces the error).

Sveltia `config.yml` references this plugin and points `backend.api_root`
to our API Gateway domain. `backend.repo` is `Maev4l/brigitte-le-roux-website`.

## §4 — Media manager Lambda + S3 CORS

### media-manager Lambda

Location: `packages/functions/media-manager/`.

- Same packaging conventions as github-gateway (ZIP, AWS-managed Node.js 22
  runtime, arm64/Graviton, Maev4l/terraform-modules Lambda ZIP module).
- Dependencies (production):
  - `@aws-sdk/client-s3`
  - `@aws-sdk/s3-request-presigner`
  - `@aws-sdk/client-cloudfront`

#### Endpoint

`POST /api/media/upload-url` (Cognito JWT required). Same `/api/*`
prefix as the github-gateway routes — the unified
`cms.brigitte-le-roux.com` CloudFront distribution (later plan) routes
`/api/*` to the HTTP API.

Request body:

```json
{
  "filename": "foo.pdf",
  "contentType": "application/pdf",
  "folder": "pdfs/publications",
  "size": 1234567
}
```

Response:

```json
{
  "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/pdfs/publications/foo.pdf?X-Amz-...",
  "publicPath": "/pdfs/publications/foo.pdf"
}
```

#### Validation

- Folder against allowlist: `pdfs`, `pdfs/publications`, `pdfs/livres`,
  `pdfs/livres/Reviews`, `img`, `data`. Anything else: 400.
- Content-type against allowlist: `application/pdf`, `image/png`,
  `image/jpeg`, `image/webp`, `application/vnd.ms-excel`,
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `text/csv`, `text/plain`. Anything else: 400.
- Filename normalization: spaces → underscores (matches existing project
  convention, commit 6155f17).
- Filename pattern after normalization: `[A-Za-z0-9._-]+`. Reject anything
  else.
- Size caps enforced two ways: (1) the caller declares `size` in the
  request body and the Lambda rejects values above the per-type cap with
  a 400 at request time; (2) the presigned PUT URL binds the exact
  `ContentLength` in its signature, so S3 rejects PUTs whose body length
  differs from the signed value (403). The original spec wording
  "Content-Length range" implied a presigned POST form policy
  (`content-length-range`); presigned PUT with bound `ContentLength`
  gives equivalent enforcement with a simpler client wire format
  (single PUT, no multipart form). Caps:
  - PDF ≤ 50 MB
  - Image ≤ 10 MB
  - Data file ≤ 100 MB
- Presigned URL TTL: 5 minutes.

#### CloudFront cache invalidation

After signing, the Lambda triggers a CloudFront invalidation for the
single path that's about to be uploaded. Cost: ~$0.005 per invalidation,
free tier 1000/month, negligible.

The file content itself never passes through the Lambda — the browser
PUTs straight to S3 using the presigned URL.

#### IAM execution role

- `s3:PutObject` on `arn:aws:s3:::<bucket>/{pdfs,img,data}/*`
- `cloudfront:CreateInvalidation` on the website distribution ARN
- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`

#### Logging

- CloudWatch Log Group, 14-day retention.
- Per upload, log: Cognito user email, filename (post-normalization),
  content-type, claimed size, folder. Not file content.

### S3 bucket CORS

Added to the existing website bucket. No new bucket.

```hcl
cors_rule {
  allowed_origins = ["https://cms.brigitte-le-roux.com"]
  allowed_methods = ["PUT", "GET", "HEAD"]
  allowed_headers = ["*"]
  expose_headers  = ["ETag"]
  max_age_seconds = 3000
}
```

The allowed origin is `cms.brigitte-le-roux.com` (where Sveltia lives) —
not the public site `brigitte-le-roux.com`, which never initiates a PUT.
Add `brigitte-le-roux.com` later only if the main site ever needs a
browser-side upload UX.

Bucket stays private. Presigned URLs honour the signature without
requiring public ACLs.

### Custom Sveltia media library plugin

`packages/website/public/cms/sveltia-s3-media.js`. ~150 lines of JS.

- Implements Sveltia's media-library plugin interface.
- On "Choose file":
  1. Browser file picker → user picks a local file.
  2. Plugin POSTs to `/api/media/upload-url` with metadata + Bearer Cognito token.
  3. Plugin receives `uploadUrl` + `publicPath`.
  4. Plugin issues `fetch(uploadUrl, { method: 'PUT', body: file })`.
     Progress reported to Sveltia's built-in progress UI.
  5. On success, returns `publicPath` to Sveltia, which inserts it into
     the field being edited.

Out of scope for v1:

- **Browsing/picking existing media.** Sveltia cannot list S3 contents
  through this plugin. Brigitte either uploads new or pastes a known
  path. Revisit if reuse becomes painful.
- **Deleting media.** No DELETE endpoint is exposed by the
  media-manager. Replacing an existing file is supported (PUT to the
  same key overwrites + invalidates CloudFront). Removing a file's
  link from a page is supported (Brigitte clears the field via the
  github-gateway commit — the S3 object becomes orphaned but no longer
  reachable from any page). Hard deletion of the underlying S3 object
  is administrator-only via the AWS console — expected to be rare
  (copyright takedown, etc.). Storage cost at this volume is
  negligible. If orphans accumulate enough to matter, a scheduled
  garbage-collection Lambda that diffs S3 against references in
  `packages/website/content/` is the safer next step (no UX changes
  required, no risk of accidental delete via typo from an editor who
  can't see the filesystem). Revisit when needed.

## §5 — CI/CD (website only)

A single GitHub Actions workflow handles website deploys. Functions and
infrastructure are deployed locally by the administrator.

### Workflow: deploy-website

`.github/workflows/deploy-website.yml`.

- Triggers: push to `main` where the paths touch `packages/website/**` or
  the workflow file itself.
- Steps:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` + Yarn cache (key on `yarn.lock`)
  3. `aws-actions/configure-aws-credentials@v4` — assume the
     `gha-website-deploy` role via OIDC.
  4. `yarn --cwd packages/website install --frozen-lockfile`
  5. `yarn --cwd packages/website pull --delete` — sync `public/` from S3
     into the runner workspace. Required because `public/` is gitignored.
  6. `yarn --cwd packages/website build`
  7. `aws s3 sync packages/website/dist/ s3://<bucket>/ --delete`
  8. `aws cloudfront create-invalidation --paths "/*"`
- Failure email: GitHub repo notification settings → email to the administrator on
  Actions failure.
- Failure comment: a final step that runs only on failure posts a French
  commit comment ("Une erreur empêche la mise en ligne — l'administrateur a été notifié.")
  so Brigitte sees something in Sveltia.

### OIDC role

`packages/infrastructure/iam-gha.tf`.

- Single role: `gha-website-deploy`.
- Trust: GitHub OIDC provider; subject locked to
  `repo:Maev4l/brigitte-le-roux-website:ref:refs/heads/main`.
- Permissions: `s3:Put/Delete/Get/List*` on the website bucket;
  `cloudfront:CreateInvalidation` on the distribution. Nothing else.

No `gha-infra-deploy` role — functions and infra are administrator-laptop-only.

### Local deployment (administrator)

Functions:

- `yarn backend:build` → Makefile installs production deps and produces a
  ZIP artefact for each function under
  `packages/functions/<name>/dist/<name>.zip`.
- `yarn backend:deploy` → Makefile builds (same as above) then runs
  `yarn infra:apply`. Terraform's Lambda resources reference the ZIP via
  `filename` + `source_code_hash`; a fresh hash triggers an update.

Infrastructure-only changes:

- `yarn infra:plan` / `yarn infra:apply` directly.

The Makefile orchestrator at `packages/functions/Makefile` exposes
per-function targets (`build-github-gateway`, `build-media-manager`) for
when only one function changed, but the root `package.json` only carries
the "all functions" forms.

### CODEOWNERS + path allowlist

Defence in depth:

1. `.github/CODEOWNERS` declares the administrator as owner of:
   - `/packages/infrastructure/`
   - `/packages/functions/`
   - `/.github/`
   - `/packages/website/src/`
   - `/packages/website/astro.config.mjs`

2. Branch protection on `main` requires CODEOWNERS review on PRs that
   touch those paths.

3. **Primary fence**: the `github-gateway` Lambda's path allowlist rejects
   any commit (PR or direct push) whose files fall outside
   `packages/website/content/`. Returns 403 to Sveltia. This is enforced
   unconditionally and cannot be bypassed by going through Sveltia.

### Branch protection on `main`

- Status checks required to pass: deploy-website workflow on PRs.
- Direct push from the GitHub App allowed (Sveltia commits go straight to
  `main`). Lambda allowlist + Zod build-time validation are the real
  safety net.

## §6 — Onboarding, runbooks, failure modes

### Brigitte's onboarding (one-time)

- The administrator creates her Cognito user in the AWS console. Cognito emails her a
  link to set her own password.
- The administrator provides a one-page French crib sheet at `docs/cms-guide-fr.md` (also
  printed as PDF). Topics:
  - "Se connecter"
  - "Ajouter une publication" / "Ajouter un livre"
  - "Modifier une page (CV, Recherches…)"
  - "Téléverser un PDF"
  - "Mes modifications n'apparaissent pas en ligne"
- Optional 3–5 min screencast of the four core flows.
- Single walkthrough call with the administrator before she edits in earnest.

### Runbooks (in `docs/runbooks/`)

- `rotate-github-app-key.md` — quarterly: regenerate the GitHub App
  private key, update the SSM parameter, force a Lambda redeploy so a
  fresh process reads the new key at cold start.
- `recover-from-build-failure.md` — for when Brigitte's edit makes
  `yarn build` fail. Read Actions log, identify Zod error, decide between
  fix-forward (edit the file directly) or `git revert <commit>` then push.
- `add-a-second-editor.md` — if another editor ever joins: create another
  Cognito user; no other changes.
- `bump-lambda-runtime.md` — when AWS deprecates a Node runtime: update
  `runtime` in the Lambda Terraform resource, `yarn backend:deploy` to
  repackage on the new runtime.

### Failure modes summary

| Failure | Brigitte sees | Site impact | Detection |
| --- | --- | --- | --- |
| Cognito down | Can't log in | None — site still served from CloudFront | AWS Health Dashboard |
| github-gateway 5xx | "Save failed" toast | None | CloudWatch alarm → SNS → administrator email |
| media-manager 5xx | "Upload failed" | None | CloudWatch alarm → SNS → administrator email |
| Invalid YAML / Zod | "Saved", then GitHub Actions fails | None — last good version stays | GA failure email; commit comment in French |
| Lambda path-allowlist 403 | "Save failed" | None | CloudWatch log |
| S3 sync partial | Possibly partial site | Mitigated by put-then-delete order | GA failure email |
| Brigitte deletes a key page | Page 404 | Real impact | `git revert` recipe |
| App key leak | 1 h window for attacker | Path allowlist limits damage | Insights audit + rotation |

### CloudWatch alarms

- API Gateway 5xx > 0 in any 5-minute window → SNS topic → administrator email.
- Lambda errors > 0 in any 5-minute window (per function) → same SNS.
- Lambda duration > 80 % of timeout → warn.

### Explicit out-of-scope (v1)

- Media browsing / reuse in Sveltia.
- Media deletion (no DELETE endpoint; replace-by-overwrite handles most cases — see §4).
- Editorial workflow (draft → review → publish).
- Bulk import / migration UI.
- Sveltia-driven editing of `content/i18n/`.
- Publications search / filter (already deferred in CLAUDE.md).
- True visual preview that renders with the site's CSS.
- Bureau page in EN (already deferred).
- Image optimization at build time.
- S3 versioning (off per CLAUDE.md; toggle on when needed).

### Follow-ups worth tracking

1. Image optimization at build time once image sizes warrant.
2. Sveltia version pinning + review of the changelog before any bump.
3. Make Cognito MFA required once Brigitte is comfortable with the login
   flow.
4. Backup posture: S3 versioning currently off. Enable when accidental
   overwrites become a risk.
5. Schema-drift lint: small CI check that flags when
   `packages/website/src/content/config.mjs` diverges from
   `packages/website/public/cms/config.yml`.

## Implementation phasing

Suggested phasing (the actual implementation plan will refine this):

1. **§0 Refactor** — single commit. Pause here for the administrator to commit, create
   the public GitHub remote, push.
2. **Cognito + API Gateway + SSM scaffolding** — Terraform only, no
   Lambda code yet. Verify Cognito User Pool with a dummy user via the
   SRP login that Sveltia will use (or via the Cognito-managed Hosted UI
   as a quick sanity check).
3. **github-gateway Lambda** — including the GitHub App, path allowlist,
   commit-author rewrite. End-to-end: dummy Sveltia config commits a
   text file via the gateway.
4. **media-manager Lambda** + S3 CORS. End-to-end: dummy Sveltia config
   uploads a PDF to S3.
5. **Sveltia config + custom plugins** — full collection definitions per
   §2. End-to-end with both Lambdas wired in.
6. **GitHub Actions deploy-website workflow** — OIDC role, deploy.
7. **CODEOWNERS + branch protection** — wired up after the workflow is
   stable.
8. **Onboarding** — French guide, screencast, walkthrough with Brigitte.
9. **Cutover** — remove the manual `yarn deploy` from the administrator's habit; Brigitte
   editing autonomously.

Each step has its own verification gate; the existing manual `yarn deploy`
(now `yarn frontend:deploy`) remains as an escape hatch throughout.

## Reference

- Site design spec: `docs/superpowers/specs/2026-05-16-brigitte-leroux-website-design.md`
- Listing layouts: `docs/superpowers/specs/2026-05-17-listing-layouts-design.md`
- Project CLAUDE.md (to be updated as part of §0)
