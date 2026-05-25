# Sveltia S3 Media Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sveltia's built-in S3 media library to the existing media-manager Lambda credentials endpoint from Plan 7. After the editor signs in via Cognito SRP, the OAuth shim fetches the IAM user's access key + secret from `GET /api/media/s3-credentials` and stashes the secret into Sveltia's preferences storage. Sveltia then signs S3 PUTs directly from the browser — file bytes never traverse Lambda. End state: editor uploads PDFs and images via Sveltia's file/image widgets and they land in S3 with the matching public URL on the main site.

**Architecture:**

```
editor signs in via Cognito SRP (existing OAuth shim, Plan 8)
   │
   ├── (NEW) shim fetches GET /api/media/s3-credentials with the id_token as Bearer
   │   └── media-manager Lambda returns { access_key_id, secret_access_key } from SSM
   │
   ├── (NEW) shim writes secret to localStorage:
   │   localStorage['sveltia-cms.prefs'].apiKeys.aws_s3 = secret_access_key
   │
   ├── shim postMessages id_token to Sveltia + closes (existing protocol)
   ▼
Sveltia receives token, loads config.yml (now includes media_libraries.aws_s3)
   │   config tells Sveltia: bucket, region, access_key_id (public-ish), prefix, public_url
   ▼
Editor uploads a file via the file/image widget
   │   Sveltia reads access_key_id from config, secret from localStorage
   │   Sveltia builds SigV4 PUT directly to S3 (Web Crypto, no SDK)
   ▼
S3 bucket brigitte-le-roux-website (CORS already allows cms.brigitte-le-roux.com)
   │   File lands at s3://brigitte-le-roux-website/<prefix>/<filename>
   ▼
Sveltia inserts the public URL into the editor's form field:
   https://brigitte-le-roux.com/<prefix>/<filename>
   ▼
Editor saves the page entry → github-gateway commits the markdown referencing the new URL
   → deploy-website rebuilds → live within ~2 min
```

**Tech Stack:**

- Sveltia 0.163.0+ `media_libraries.aws_s3` config (built-in S3 media library; no plugins)
- The OAuth shim from Plan 8 (`packages/website/public/cms/auth/index.html`) gains ~20 lines of pre-postMessage credential-fetch logic
- The Sveltia config (`packages/website/public/cms/config.yml`) gets a new top-level `media_libraries.aws_s3` block (replaces the temp `media_folder: packages/website/public/data` workaround we added during Plan 8 smoke)
- No backend changes — media-manager Lambda already exists (Plan 7), credentials endpoint works, S3 CORS already allows the CMS subdomain (Plan 5)

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §4 (media-manager Lambda + Sveltia S3 media library).

---

## Preconditions

- On `main`, working tree clean.
- Plan 7's `/api/media/s3-credentials` endpoint returns 200 with `{access_key_id, secret_access_key}` for authenticated callers. (Verified during Plan 7 smoke.)
- Plan 8 is shipped: CMS at `https://cms.brigitte-le-roux.com/cms/` works end-to-end for text editing, OAuth shim handshake completes via postMessage.
- `$TEST_USER_EMAIL` + `$TEST_USER_PASSWORD` exported for the smoke test in Task 6.
- AWS CLI configured with the admin role (so we can `aws ssm get-parameter` to fetch the access_key_id in Task 2).

## Approach notes

- **Single flat S3 prefix `data/`.** Sveltia's `media_libraries.aws_s3.prefix` is global — all CMS uploads land at that one prefix. The site uses a single flat `/data/<basename>` URL space (set up in the pre-Plan-9 migration), so this matches the site convention rather than fighting it. PDFs, photos, archives — anything uploaded via the CMS lands at `s3://brigitte-le-roux-website/data/<filename>` and serves from `https://brigitte-le-roux.com/data/<filename>`. The IAM user is scoped to `data/*` only (tightened from the earlier `pdfs/*, img/*, data/*` allowlist).
- **access_key_id is in `config.yml`** (hardcoded after one-time SSM fetch). It's public-ish (visible to anyone with /cms/config.yml access — which is anyone on the internet) but useless without the secret. The secret lives in localStorage via the auth shim. Trade-off: rotation requires both an SSM update AND a config.yml commit + deploy.
- **Cleanup of Plan 8's temp `media_folder` workaround.** Plan 8 added a top-level `media_folder: packages/website/public/data` to keep Sveltia's config validator happy. With `media_libraries.aws_s3` present, Sveltia uses S3 instead of the Internal library and the top-level `media_folder` becomes dead config — we leave it in place as a fallback (Sveltia's Internal library would error closed via the path-allowlist on the github-gateway if anything ever fell back to it).
- **CloudFront stale-cache after replace.** Replacing an uploaded file with the same name leaves the OLD content cached on CloudFront (CachingOptimized policy, default 24h TTL). Editor sees old content until cache expires unless we invalidate. Accept this for v1; add to follow-ups.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/website/public/cms/auth/index.html` | modify | After Cognito SRP success, fetch `/api/media/s3-credentials` and write `secret_access_key` to `localStorage['sveltia-cms.prefs'].apiKeys.aws_s3`. ~20 lines added between the existing SRP success block and the existing postMessage handshake. |
| `packages/website/public/cms/config.yml` | modify | Add a top-level `media_libraries.aws_s3` block with `bucket`, `region`, `prefix: data`, `access_key_id: <IAM user access key>`, `public_url: https://brigitte-le-roux.com`. |
| `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` | modify | §4 now describes the realized media flow (credentials in localStorage via the shim, single flat `data/` prefix, etc.). |
| `CLAUDE.md` | modify | Brief mention in the CMS section that media uploads are wired and where they land. |

No new files, no infrastructure changes, no Lambda code changes.

---

### Task 1: Verify preconditions

- [ ] **Step 1: Branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty.

- [ ] **Step 2: Confirm Plan 7's credentials endpoint still works**

⚠️ Use `timeout: 600000` on terraform commands. Never print `$TEST_USER_EMAIL`, `$TEST_USER_PASSWORD`, or token values verbatim.

```bash
APP_CLIENT_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_app_client_id)
USER_POOL_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id)

aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH \
  --output json >/dev/null

TOKEN=$(aws cognito-idp initiate-auth \
  --client-id "$APP_CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$TEST_USER_EMAIL",PASSWORD="$TEST_USER_PASSWORD" \
  --query 'AuthenticationResult.IdToken' \
  --output text)

curl -sS https://cms.brigitte-le-roux.com/api/media/s3-credentials \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP %{http_code}\n" | jq 'keys'

aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --output json >/dev/null

unset TOKEN APP_CLIENT_ID USER_POOL_ID
```

Expected: HTTP 200, `jq 'keys'` prints `["access_key_id", "secret_access_key"]`.

- [ ] **Step 3: Confirm S3 bucket CORS still allows the CMS subdomain**

```bash
aws s3api get-bucket-cors --bucket brigitte-le-roux-website \
  --query 'CORSRules[0].{Origins:AllowedOrigins,Methods:AllowedMethods}'
```

Expected:
- `Origins` contains `https://cms.brigitte-le-roux.com`
- `Methods` contains at least `PUT` (and ideally `GET`, `HEAD`)

- [ ] **Step 4: `yarn infra:plan` shows no drift**

```bash
yarn infra:plan 2>&1 | rtk proxy grep -E 'No changes\.|Plan:' | head -3
```

Expected: contains "No changes."

---

### Task 2: Fetch the IAM user's access_key_id from SSM

The access_key_id is "public-ish" — visible to anyone with internet access to `/cms/config.yml`. The IAM user has tightly-scoped permissions (`PutObject` + `ListBucket` on three prefixes only), so the exposure is acceptable.

⚠️ NEVER print the secret_access_key — only the access_key_id. The pipe below extracts just the field we need.

- [ ] **Step 1: Read the access_key_id only**

```bash
aws ssm get-parameter \
  --name brigitte-le-roux-website.sveltia-media-manager-credentials \
  --with-decryption \
  --query 'Parameter.Value' --output text | jq -r '.access_key_id'
```

Expected: prints a string like `AKIA...` (20 chars, starts with `AKIA`). Record this value for Task 4. **Do NOT pipe the SecureString value to any other process.**

---

### Task 3: Update the OAuth shim to fetch + stash S3 credentials

**Files:**
- Modify: `packages/website/public/cms/auth/index.html`

The shim currently:
1. Renders the Cognito SRP login form.
2. On submit, authenticates the user, gets the id_token.
3. Stashes the id_token in `localStorage['cms.cognito_id_token']` (for the future Plan 9 bootstrap — that's THIS plan).
4. postMessages `authorization:github:success:{...}` to opener.
5. Closes.

We insert a step between (2) and (3): fetch the S3 creds from the media-manager Lambda and write the secret to Sveltia's preferences storage.

- [ ] **Step 1: Add the fetchAndStashS3Credentials helper**

Open `packages/website/public/cms/auth/index.html`. Find the existing `authenticate` function (the one that wraps `user.authenticateUser`). Immediately after the `authenticate` function definition, insert this new helper:

```js
    // Plan 9: after Cognito SRP succeeds we have an id_token in hand.
    // Use it to fetch the dedicated S3-uploader IAM user's access key
    // + secret from /api/media/s3-credentials, then stash the secret
    // into Sveltia's preferences-storage key (sveltia-cms.prefs.apiKeys.aws_s3).
    // Sveltia reads this synchronously when the editor opens an asset
    // browser — by the time the shim's postMessage completes and the
    // popup closes, Sveltia's auth state is ready AND its S3 secret is
    // pre-populated. Editor never enters credentials.
    //
    // Failure is non-fatal: media uploads will surface the missing-secret
    // error in Sveltia's UI on first attempt; auth still succeeds.
    async function fetchAndStashS3Credentials(idToken) {
      try {
        var response = await fetch('/api/media/s3-credentials', {
          headers: { 'Authorization': 'Bearer ' + idToken },
        });
        if (!response.ok) {
          console.warn('media-manager /s3-credentials returned', response.status);
          return;
        }
        var creds = await response.json();
        if (!creds || typeof creds.secret_access_key !== 'string') {
          console.warn('media-manager response missing secret_access_key');
          return;
        }
        var rawPrefs = localStorage.getItem('sveltia-cms.prefs');
        var prefs = {};
        if (rawPrefs) {
          try { prefs = JSON.parse(rawPrefs); } catch (_) { prefs = {}; }
        }
        prefs.apiKeys = prefs.apiKeys || {};
        prefs.apiKeys.aws_s3 = creds.secret_access_key;
        localStorage.setItem('sveltia-cms.prefs', JSON.stringify(prefs));
      } catch (err) {
        console.warn('failed to stash S3 credentials', err && err.message);
      }
    }
```

- [ ] **Step 2: Call it after Cognito SRP success, before postMessage**

In the same file, find the form-submit handler (the `form.addEventListener('submit', async function (e) {...})` block). Inside the `try` block, AFTER `var idToken = await authenticate(...)` (and AFTER the existing wait-for-sveltia-ready loop), BEFORE `postAuthorizationSuccess(idToken)`, insert:

```js
        // Plan 9: fetch + stash S3 creds so Sveltia's media library
        // has the secret ready immediately after the popup closes.
        await fetchAndStashS3Credentials(idToken);
```

The full success-path block now reads:

```js
        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;
        var idToken = await authenticate(email, password);

        var deadline = Date.now() + 2000;
        while (!sveltiaReady && Date.now() < deadline) {
          await new Promise(function (r) { setTimeout(r, 50); });
        }

        await fetchAndStashS3Credentials(idToken);

        postAuthorizationSuccess(idToken);

        try {
          localStorage.setItem('cms.cognito_id_token', idToken);
        } catch (_) { /* ignore quota errors */ }

        setTimeout(function () { window.close(); }, 200);
```

- [ ] **Step 3: Quick visual sanity check**

```bash
test -f packages/website/public/cms/auth/index.html && wc -l packages/website/public/cms/auth/index.html
rtk proxy grep -c 'fetchAndStashS3Credentials' packages/website/public/cms/auth/index.html
rtk proxy grep -c 'apiKeys.aws_s3' packages/website/public/cms/auth/index.html
```

Expected:
- file exists, line count grew by ~25-30 (was ~197 in Plan 8, now ~220-225)
- `fetchAndStashS3Credentials` appears twice (definition + call)
- `apiKeys.aws_s3` appears once (the assignment line)

---

### Task 4: Add `media_libraries.aws_s3` to Sveltia config.yml

**Files:**
- Modify: `packages/website/public/cms/config.yml`

- [ ] **Step 1: Insert the media_libraries block**

Open `packages/website/public/cms/config.yml`. Find the existing top-level `media_folder` line (the temp workaround we added during Plan 8 smoke, around line 34):

```yaml
media_folder: packages/website/public/data
public_folder: /data
```

REPLACE that block with:

```yaml
# Top-level media_folder / public_folder are no longer the active path —
# media_libraries.aws_s3 below takes precedence. We leave them set to
# packages/website/public/data / /data as defense-in-depth: if Sveltia
# ever falls back to its Internal media library, a stray upload would
# target the website's public/ tree and the github-gateway's path
# allowlist would reject the commit (so editor sees an error rather
# than silent success against an unintended location).
media_folder: packages/website/public/data
public_folder: /data

# Plan 9: Sveltia's built-in S3 media library. The IAM user
# `brigitte-le-roux-website-sveltia-media-manager` is scoped to
# PutObject + ListBucket on s3://brigitte-le-roux-website/data/*.
# All CMS uploads land at /data/<filename> — the site uses a single
# flat /data/* URL space (set up in the pre-Plan-9 migration), so the
# Sveltia prefix matches the site convention directly.
#
# The access_key_id below is half of the credential pair — visible to
# anyone with internet access to /cms/config.yml. The secret lives in
# localStorage (sveltia-cms.prefs.apiKeys.aws_s3) and is auto-populated
# by the OAuth shim on login (see auth/index.html — Plan 9 update).
# Rotating the IAM user's keys: update the SecureString, update the
# access_key_id below, redeploy.
media_libraries:
  aws_s3:
    access_key_id: <ACCESS_KEY_ID_FROM_TASK_2>
    bucket: brigitte-le-roux-website
    region: eu-central-1
    prefix: data
    public_url: https://brigitte-le-roux.com
    force_path_style: false
```

**Replace `<ACCESS_KEY_ID_FROM_TASK_2>`** with the actual access_key_id value you captured in Task 2.

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "const yaml=require('/Users/jrsue/dev/repos/brigitte-leroux-website/packages/website/node_modules/js-yaml'); const fs=require('fs'); const cfg=yaml.load(fs.readFileSync('packages/website/public/cms/config.yml','utf8')); console.log('media_libraries keys:', Object.keys(cfg.media_libraries||{})); console.log('aws_s3:', {bucket: cfg.media_libraries.aws_s3.bucket, region: cfg.media_libraries.aws_s3.region, prefix: cfg.media_libraries.aws_s3.prefix, public_url: cfg.media_libraries.aws_s3.public_url, access_key_starts_with: (cfg.media_libraries.aws_s3.access_key_id||'').slice(0,4)});"
```

Expected:
- `media_libraries keys: [ 'aws_s3' ]`
- `aws_s3: { bucket: 'brigitte-le-roux-website', region: 'eu-central-1', prefix: 'data', public_url: 'https://brigitte-le-roux.com', access_key_starts_with: 'AKIA' }`

---

### Task 5: Deploy + invalidate

⚠️ **NEVER use a surgical `aws s3 cp` on the CMS files of a working
tree that diverges from `main`.** The `deploy-website` GHA workflow
runs on every push to `main`, rebuilds from main's HEAD, and
`aws s3 sync --delete`s `dist/` over the bucket — overwriting any
surgical upload that doesn't match main. The Plan 9 smoke testing
hit this race twice (an unrelated push to main triggered GHA, which
clobbered the just-uploaded shim + config). The only safe deploy
paths are the two below.

- [ ] **Step 1: Deploy via local script (preferred for CMS-only changes)**

```bash
yarn frontend:deploy 2>&1 | tail -5
```

⚠️ Use `timeout: 600000`. Runs the Astro build (no-op for CMS-only
changes) + full S3 sync + public-site CloudFront invalidation. Safe
against the GHA race because nothing else is racing with this script
locally — there's only one sync writer.

OR — **commit + push to main, let GHA deploy** (also safe, takes ~2 min):

```bash
git add packages/website/public/cms/auth/index.html packages/website/public/cms/config.yml
git commit -m "<see Task 8>"  # actual commit happens in Task 8
git push origin main
gh run watch  # wait for deploy-website workflow
```

- [ ] **Step 2: Invalidate the CMS distribution's edge cache for /cms/***

```bash
CMS_DIST=$(terraform -chdir=packages/infrastructure output -raw cms_distribution_id)
aws cloudfront create-invalidation --distribution-id "$CMS_DIST" --paths '/cms/*' \
  --query 'Invalidation.{Id:Id,Status:Status}'
```

Expected: prints an invalidation Id, Status `InProgress`. Propagation takes ~30-60 s.

- [ ] **Step 3: Verify the served files have the changes**

```bash
echo "=== media_libraries block in served config.yml ==="
curl -sS https://cms.brigitte-le-roux.com/cms/config.yml | rtk proxy grep -A6 'media_libraries:' | head -10
echo
echo "=== fetchAndStashS3Credentials in served auth/index.html ==="
curl -sS https://cms.brigitte-le-roux.com/cms/auth/index.html | rtk proxy grep -c 'fetchAndStashS3Credentials'
```

Expected:
- The media_libraries block printout shows `bucket: brigitte-le-roux-website`, `region: eu-central-1`, `prefix: data`, `public_url: https://brigitte-le-roux.com`, and the access_key_id starting with `AKIA`.
- `fetchAndStashS3Credentials` count is 2.

If the edge still serves stale content after 60 s, re-run the invalidation (or wait — CachingDisabled on /api/* doesn't mean CachingDisabled on /cms/*, which uses CachingOptimized).

---

### Task 6: Browser smoke test (human operator)

This task cannot be automated by a subagent — a real browser is required. A subagent invocation should produce the checklist below for the human operator.

- [ ] **Step 1: Fresh incognito session + IndexedDB clear**

Open a fresh incognito window at `https://cms.brigitte-le-roux.com/`. **Before reload**, open DevTools Console and run:

```js
indexedDB.deleteDatabase('github:Maev4l/brigitte-le-roux-website')
```

Then hard-reload (Cmd-Shift-R). This avoids the Sveltia file-list cache short-circuit we discovered during Plan 8 smoke (see Plan 8 deviations callout).

- [ ] **Step 2: Sign in**

Click "Sign in with GitHub". Popup opens (`/cms/auth/?provider=github&site_id=...`). Enter your Cognito email + password. Popup closes within ~1 s.

- [ ] **Step 3: Verify the S3 secret was stashed**

In DevTools Console:

```js
const prefs = JSON.parse(localStorage.getItem('sveltia-cms.prefs') || '{}');
console.log('has apiKeys:', !!prefs.apiKeys);
console.log('has aws_s3 secret:', !!(prefs.apiKeys && prefs.apiKeys.aws_s3));
console.log('aws_s3 secret length:', (prefs.apiKeys && prefs.apiKeys.aws_s3 || '').length);
```

Expected: all three log lines should report truthy / a 40-char length (don't print the secret itself).

- [ ] **Step 4: Open the home page entry**

Click into **Page d'accueil** → home (FR/EN). Locate the portrait field (`src` + `alt` group). The `src` is currently a text field showing a path like `/data/photoweb.jpg`.

- [ ] **Step 5: Try uploading a new image**

Click the file/upload control next to the portrait `src` field (Sveltia auto-adds an upload UI for file/image widgets backed by an S3 media library). Pick a small test PNG (~50 KB) from your local filesystem. Sveltia should:

- Show an upload progress indicator
- Complete within a second or two
- Insert the resulting URL into the `src` field — should look like `https://brigitte-le-roux.com/data/<test-filename>.png`

- [ ] **Step 6: Verify the object landed in S3**

In a terminal:

```bash
aws s3 ls s3://brigitte-le-roux-website/data/ --recursive | rtk proxy grep '<test-filename>'
```

Expected: one line with the test file's key, today's date, and the file size.

- [ ] **Step 7: Verify the public URL serves the file**

```bash
curl -sSI 'https://brigitte-le-roux.com/data/<test-filename>.png' | head -3
```

Expected: HTTP 200 (or 302 → 200 if a redirect chain is involved). The content-type should match the file's MIME type.

- [ ] **Step 8: Revert + cleanup**

Back in the Sveltia editor: undo the `src` field change (restore the original value). Click **Save**. Verify the commit lands on `main`.

Clean up the test file from S3:

```bash
aws s3 rm s3://brigitte-le-roux-website/data/<test-filename>.png
```

- [ ] **Step 9: Report**

If everything worked: report **PASS**, proceed to Task 7.

If something failed, capture:
- The exact error message in the browser (toast, console, or Network response body)
- The HTTP status of the S3 PUT in DevTools Network tab
- Whether the secret made it to localStorage (Step 3 confirms)

Common failure modes + likely cause:
- **403 on the S3 PUT**: CORS, signature mismatch, or IAM scope. Check `aws s3api get-bucket-cors` and the IAM user's policy.
- **CORS preflight 404**: S3 bucket CORS missing the origin or HTTP method.
- **Sveltia prompts for an API key**: the secret didn't make it into `sveltia-cms.prefs.apiKeys.aws_s3`. Check the shim's console.warn output.

---

### Task 7: Roll Plan 9 outcomes into the spec + CLAUDE.md

**Files:**
- Modify: `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update spec §4**

In `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md`, find the §4 section that describes how Sveltia consumes the credentials endpoint. Add a paragraph (or sub-section) noting:

- The auth shim performs the cred-fetch + localStorage write at login time (not a separate bootstrap script).
- All CMS uploads target a single flat `data/` prefix matching the site's `/data/<basename>` URL space.
- Replacing an uploaded file with the same name leaves CloudFront serving the old cached content until TTL (default 24h) — known limitation.

Quote the new code path:

```js
// In packages/website/public/cms/auth/index.html, after Cognito SRP success:
await fetchAndStashS3Credentials(idToken);
//   → fetches /api/media/s3-credentials with Bearer
//   → writes secret_access_key to localStorage['sveltia-cms.prefs'].apiKeys.aws_s3
//   → Sveltia reads from there on first upload
```

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, find the section that mentions Sveltia (probably near the "Static assets" or "Content model" headings). Add a brief paragraph:

```markdown
### Media uploads (via the CMS)

The editor uploads PDFs and images through Sveltia's built-in S3 media
library. Files land at `s3://brigitte-le-roux-website/data/<filename>`
and serve from `https://brigitte-le-roux.com/data/<filename>` (public-site
CloudFront, same as legacy uploads). Sveltia signs the S3 PUT directly
from the browser using the IAM user `brigitte-le-roux-website-sveltia-media-manager`
(scoped to PutObject + ListBucket on `data/*` only).
The access_key_id is in `public/cms/config.yml`; the secret is fetched
from the media-manager Lambda at login and stashed in localStorage —
the editor never enters credentials.

Limitations (v1, may be revisited):
- Replacing an existing file with the same name shows stale content
  on the public site until CloudFront's TTL expires (24h default).
```

---

### Task 8: Commit + push

- [ ] **Step 1: Commit the CMS frontend changes**

```bash
git add packages/website/public/cms/auth/index.html packages/website/public/cms/config.yml

git commit -m "$(cat <<'EOF'
feat(cms): Sveltia S3 media uploads via the auth-shim credential bootstrap

Wires Sveltia's built-in S3 media library to the media-manager Lambda's
credentials endpoint (Plan 7). The OAuth shim, immediately after the
Cognito SRP exchange, fetches the IAM user's access key + secret from
GET /api/media/s3-credentials and stashes the secret into Sveltia's
preferences storage (localStorage['sveltia-cms.prefs'].apiKeys.aws_s3).
By the time the popup closes and Sveltia regains focus, the S3 secret
is already in place — the editor never enters credentials.

- packages/website/public/cms/auth/index.html
  New fetchAndStashS3Credentials helper called after Cognito SRP
  success and before postMessage. Failure is non-fatal (logged via
  console.warn; Sveltia's media UI will surface the missing secret
  on first upload attempt).

- packages/website/public/cms/config.yml
  New top-level media_libraries.aws_s3 block:
    - bucket: brigitte-le-roux-website
    - region: eu-central-1
    - prefix: data
    - public_url: https://brigitte-le-roux.com
    - access_key_id: AKIA... (the IAM user's access key — public-ish,
      useless without the secret)
  Top-level media_folder kept as a defensive fallback if Sveltia ever
  selects the Internal media library (path allowlist on github-gateway
  would then reject the commit, so editor sees a clear error rather
  than a silent successful commit to an unintended location).

End-to-end smoke test passed: editor uploaded a test PNG via the
portrait field, file landed at s3://brigitte-le-roux-website/data/, URL
served correctly from https://brigitte-le-roux.com/data/<filename>.

Known v1 limitation (documented in spec §4 + CLAUDE.md):
- Replacing a file with the same name shows stale content on the
  public site until CloudFront's 24h TTL expires.
EOF
)"
```

- [ ] **Step 2: Commit the docs updates**

```bash
git add docs/superpowers/specs/2026-05-20-content-editing-cms-design.md CLAUDE.md

git commit -m "$(cat <<'EOF'
docs: fold Plan 9 (Sveltia S3 media uploads) into spec + CLAUDE.md

- spec §4: documents the realized media-flow — auth shim fetches the
  credentials endpoint at login, writes secret to Sveltia's
  localStorage prefs (sveltia-cms.prefs.apiKeys.aws_s3). Notes the
  single-S3-prefix v1 limitation and the CloudFront-stale-cache
  trade-off on same-name replacement.

- CLAUDE.md: adds a "Media uploads (via the CMS)" subsection describing
  where uploaded files land, what IAM user signs the PUTs, and the
  known limitations.
EOF
)"
```

- [ ] **Step 3: Push to main**

```bash
git push origin main 2>&1 | tail -3
```

Expected: succeeds.

- [ ] **Step 4: Confirm the deploy-website workflow DID NOT run for the CMS-only commit**

```bash
gh run list --workflow=deploy-website.yml --limit 1 --json status,headSha,createdAt
```

The path filter is `packages/website/**`. The CMS commit DOES touch that path (we modified files under `packages/website/public/cms/`), so the workflow WILL run. That's fine — it's a no-op for the public site (config + shim files don't affect the Astro build output).

Wait for the run to complete: `gh run watch` (optional).

---

## Execution deviations (recorded post-smoke)

These came up during the smoke test (Task 6) and required Plan 9 to
grow beyond the originally-described CMS-only edits. Captured here
so the next reader doesn't re-discover them.

1. **Surgical `aws s3 cp` is unsafe** when working-tree CMS files
   diverge from `main` — see Task 5's warning callout. The race bit
   twice during smoke; once the migration commit (`2a65ee6`) was
   pushed to main, GHA rebuilt and overwrote the surgical uploads
   with the pre-Plan-9 versions still in main's HEAD.

2. **Sveltia hardcodes `x-amz-acl: public-read`** on every PUT with
   no config knob to suppress it. Three AWS-side accommodations
   landed in this plan beyond what was originally scoped (see also
   spec §4):
   - `aws_s3_bucket_ownership_controls.site` set to
     `BucketOwnerPreferred` (was the implicit `BucketOwnerEnforced`
     default — which rejects all ACL headers).
   - `aws_s3_bucket_public_access_block.block_public_acls = false`
     (kept `ignore_public_acls = true` so the ACL is set but inert).
   - IAM policy adds `s3:PutObjectAcl` alongside `s3:PutObject`
     (`data/*` scope unchanged).

3. **IAM `ListBucket` cannot have an `s3:prefix StringLike data/*`
   condition.** Sveltia's media picker calls ListBucket without (or
   with a non-matching) prefix, so the condition denies the request.
   Loosened to bucket-wide ListBucket; the bucket is publicly
   readable via CloudFront anyway so this exposes nothing new.

4. **Sveltia's `prefix` config needs a trailing slash.** The plan's
   `prefix: data` produced PUTs against `dataphoto.jpg` (no separator
   inserted). Fixed to `prefix: data/`.

5. **`portrait.src` must be `widget: image`, not `widget: string`.**
   Plain string widgets have no file picker; Sveltia only renders one
   for image/file widgets. Plan 9 originally assumed an image widget
   was already in place. Other media-reference fields (publication
   `pdf`, book review URLs, etc.) remain `widget: string` for v1.

6. **Sveltia commits binary uploads to git** alongside the S3 PUT,
   via a GraphQL `createCommitOnBranch` mutation that bundles the
   markdown delta and the binary file (base64) into one atomic
   commit. This surfaced a real defense-in-depth gap: the
   github-gateway's path allowlist was REST-only (Contents API +
   Trees API), so the GraphQL mutation walked past it. Closed in a
   follow-up commit: `lib/allowlist.mjs` now has
   `extractPathsFromGraphqlBody` and the gateway's GraphQL branch
   runs `findForbiddenPath` before forwarding. `public/data/` joins
   `content/` in `ALLOWED_PATH_PREFIXES` so Sveltia's legitimate
   uploads still succeed. Anything else — `packages/functions/`,
   `.github/workflows/`, etc. — now returns 403 from the gateway.
   Synthetically verified during the fix:
   - `additions[].path: "packages/functions/malicious.mjs"` → 403
     `{"error":"Path not in allowlist", ...}`
   - `additions[].path: "packages/website/content/pages/test.md"` →
     gateway accepts; GitHub rejects later on the synthetic invalid
     `expectedHeadOid`. (Proves allowlist isn't the blocker.)

   Binaries still accumulate in git despite the allowlist (the
   `data/` prefix is permitted), but the GHA deploy `--exclude`s
   `data/*` from S3 sync so the git copies don't propagate. Periodic
   `git rm packages/website/public/data/*` sweep cleans them.

7. **Sveltia secret in localStorage** is keyed on `sveltia-cms.prefs`
   (object) → `apiKeys.aws_s3` (string). Confirmed correct path via
   reading Sveltia source; verified via DevTools during smoke.

---

## Self-Review

**Spec coverage** (against spec §4 — media manager + S3 media library):

| Spec requirement | Plan task |
| --- | --- |
| Sveltia uses its built-in S3 media library (no custom plugin) | Task 4 (media_libraries.aws_s3 in config.yml) |
| Credentials fetched at login from /api/media/s3-credentials | Task 3 (auth shim fetch) |
| Secret stashed in Sveltia's localStorage prefs (apiKeys.aws_s3) | Task 3 |
| access_key_id static in config.yml (rotation = SSM + config commit) | Task 4 |
| IAM user scoped to PutObject + ListBucket on data/* | (existing — Plan 7) |
| S3 bucket CORS allows cms.brigitte-le-roux.com | (existing — Plan 5) |
| File bytes never traverse Lambda | (existing — Plan 7's design, validated here by Sveltia's direct S3 PUT) |
| End-to-end smoke (upload + public URL serves) | Task 6 |

**Out of scope** (handled in later plans / accepted as v1 limitations):

- CloudFront cache invalidation on file-replace. v1 trade-off: editor sees stale content until 24h TTL. Possible mitigation: a small post-upload hook in Sveltia (unsupported) OR a follow-up Lambda that subscribes to S3 events and invalidates CloudFront paths.
- API hardening (Plan 10): force traffic through CloudFront via origin custom header. Independent of media uploads.

**Placeholder scan:** every code step has a concrete code block; `<ACCESS_KEY_ID_FROM_TASK_2>` is the only placeholder, and it's marked as a hand-off from Task 2's output (NOT a "fill in later" — the value is recorded in Task 2 Step 1).

**Type / contract consistency:**

- `localStorage['sveltia-cms.prefs'].apiKeys.aws_s3` is the correct key (verified by reading Sveltia's `prefs.js` + `api-key-input.svelte` source during Plan 8 research).
- The response shape `{ access_key_id, secret_access_key }` matches what the media-manager Lambda returns (Plan 7 contract).
- `media_libraries.aws_s3` config keys (`bucket`, `region`, `prefix`, `access_key_id`, `public_url`, `force_path_style`) match Sveltia's documented schema.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-24-sveltia-s3-media-uploads.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration. Task 6 (browser smoke test) returns control to the human operator.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
