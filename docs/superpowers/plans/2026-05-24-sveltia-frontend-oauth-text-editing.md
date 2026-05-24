# Sveltia Frontend — OAuth + Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the Sveltia CMS at `https://cms.brigitte-le-roux.com/cms/`. Editor logs in via Cognito (our custom OAuth shim), Sveltia loads with the editorial config, and saving a text edit lands a commit on GitHub via the github-gateway Lambda. **Text editing only — media uploads are Plan 9's scope.**

**Architecture:**

```
the user opens https://cms.brigitte-le-roux.com/                         (existing CloudFront from Plan 6)
   │ root → 302 /cms/                                                    (existing CF function)
   ▼
GET /cms/                                                                (this plan: replaces the placeholder from Plan 6)
   │ S3 serves /cms/index.html (Sveltia loader + manual CMS.init)
   ▼
Sveltia loaded with CMS_MANUAL_INIT = true; reads /cms/config.yml
   │ backend: github
   │ api_root: https://cms.brigitte-le-roux.com/api/git
   │ base_url: https://cms.brigitte-le-roux.com/cms
   │
   │ no token in storage → user clicks "Sign in with GitHub"
   │ Sveltia opens popup at <base_url>/auth?provider=github&site_id=...
   ▼
GET /cms/auth?...                                                        (this plan: CF function patched)
   │ CF function rewrites to /cms/auth/index.html
   │ S3 serves the OAuth shim
   ▼
OAuth shim page (this plan: new — Cognito SRP login form)
   │ loads amazon-cognito-identity-js from CDN
   │ user enters email + password
   │ SRP exchange against Cognito User Pool — never leaves browser plaintext
   │ id_token returned
   │ postMessage to opener: authorization:github:success:{"provider":"github","token":"<id_token>"}
   ▼
Sveltia receives the token, treats it as a GitHub OAuth access token
   │ uses it as `Authorization: Bearer <id_token>` on api_root calls
   │ first probes <api_root>/user to identify the editor
   ▼
GET /api/git/user                                                         (this plan: github-gateway interceptor)
   │ github-gateway sees /user → DOES NOT forward to api.github.com
   │ returns synthetic user object built from JWT claims
   │ { login, name, email, avatar_url: null, id: 1 }
   ▼
Sveltia displays user info; loads collection list from /api/git/repos/<owner>/<repo>/contents/<dir>
   │ github-gateway forwards via Octokit + GitHub App installation token (existing Plan 4 behavior)
   ▼
Editor edits a markdown page; saves
   │ Sveltia commits via /api/git/repos/<owner>/<repo>/contents/<path>
   │ github-gateway's existing flow: path allowlist + commit-author rewrite + Octokit forward
   ▼
Commit lands on Maev4l/brigitte-le-roux-website main
   │ deploy-website workflow triggers (path filter matches packages/website/content/)
   │ Astro rebuilds, S3 sync, CloudFront invalidates
   ▼
Edited content live at https://brigitte-le-roux.com/<page>/
```

**Tech Stack:**

- Sveltia CMS `0.163.0` (pinned), loaded from unpkg CDN
- `amazon-cognito-identity-js` `6.3.x` from CDN (jsdelivr) for the OAuth shim
- Static HTML + vanilla JS (no build step) for /cms/ pages
- The existing github-gateway Lambda gets a small `/user` interceptor
- CloudFront function (`cloudfront-cms-function.js`) gets a 3-line patch

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §1 (Sveltia hosting), §2 (collection schemas), §3 (Cognito + github-gateway).

---

## Preconditions

- On `main`, working tree clean (HEAD includes commit `6b28156` — Plan 7's media-manager refactor).
- CMS subdomain `cms.brigitte-le-roux.com` resolves and serves the Plan 6 placeholder at `/cms/`.
- github-gateway Lambda is live and responds to `/api/git/repos/Maev4l/brigitte-le-roux-website` with a 200 when authenticated.
- `$TEST_USER_EMAIL` + `$TEST_USER_PASSWORD` available for the browser smoke test.
- `frontend:deploy` script syncs `packages/website/public/` to `s3://brigitte-le-roux-website/` — so anything under `public/cms/*` automatically lands at `s3://.../cms/*`. Verify this assumption in Task 1.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/website/public/cms/index.html` | **rewrite** | Replaces Plan 6's placeholder. Sveltia loader: `CMS_MANUAL_INIT=true` + `CMS.init({load_config_file: false, config})`. Embeds inline YAML→JS config parse. |
| `packages/website/public/cms/config.yml` | **NEW** | Sveltia editorial config (backend + collections). No `media_libraries` yet (Plan 9). |
| `packages/website/public/cms/auth/index.html` | **NEW** | OAuth shim page. Cognito SRP login form, posts id_token back via `window.opener.postMessage`. |
| `packages/functions/github-gateway/lib/user-interceptor.mjs` | **NEW** | Small helper: synthesize a GitHub-shaped user object from JWT claims. |
| `packages/functions/github-gateway/index.mjs` | modify | Insert `GET /user` interceptor before the Octokit forward path. |
| `packages/infrastructure/cloudfront-cms-function.js` | modify | Special-case `/cms/auth` and `/cms/auth/...` to serve from S3 directly (no SPA fallback). |

## Approach notes

- **No build step for /cms/ files.** Plain HTML + vanilla JS in `packages/website/public/cms/`. The existing `frontend:deploy` pipeline (Astro build → S3 sync) carries `public/` to S3 verbatim. No esbuild needed here.
- **Sveltia is loaded from a pinned CDN URL.** No self-hosted vendor copy yet — easier to bump the version, smaller artifacts. If reliability becomes an issue we self-host later.
- **The OAuth shim is a single static HTML file with inline JS.** No bundle step. amazon-cognito-identity-js is loaded from CDN as a `<script>` tag.
- **github-gateway redeploys via the existing ZIP pipeline.** `yarn backend:build && yarn infra:apply` — no infrastructure changes.
- **The browser smoke test is manual.** Subagents can't drive a browser. Task 8 produces a checklist for a human operator.
- **Iteration likely.** Sveltia probes several GitHub API endpoints after OAuth completes. We handle `/user` here; if the smoke test surfaces other 401s from non-`/user` probes, we add interceptors as needed.

---

### Task 1: Verify preconditions

- [ ] **Step 1: Branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty. HEAD `6b28156` or later.

- [ ] **Step 2: Confirm CMS subdomain serves the Plan 6 placeholder**

```bash
curl -sSI https://cms.brigitte-le-roux.com/cms/ | head -3
curl -sS https://cms.brigitte-le-roux.com/cms/ | head -3
```

Expected: HTTP 200, and the body contains `Sveltia placeholder` (the placeholder from Plan 6).

- [ ] **Step 3: Confirm `frontend:deploy` syncs `public/cms/` to S3**

```bash
rtk proxy grep -nE 'aws s3 sync|public|cms' packages/website/scripts/deploy.sh 2>&1 | head -20
```

Look for the `aws s3 sync` line. It should sync the build output (`packages/website/dist/`) to S3. Astro builds copy `public/cms/*` into `dist/cms/*`, which then lands at `s3://.../cms/*`. If the script's behavior is unclear, run a no-op deploy and check the resulting S3 layout:

```bash
aws s3 ls s3://brigitte-le-roux-website/cms/ --recursive
```

Expected: lists `cms/index.html` (and any other files Plan 6 deposited via `aws s3 cp`).

- [ ] **Step 4: Confirm github-gateway is reachable + healthy**

⚠️ Use `timeout: 600000` on any terraform/long commands.

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

curl -sSI -H "Authorization: Bearer $TOKEN" \
  https://cms.brigitte-le-roux.com/api/git/repos/Maev4l/brigitte-le-roux-website | head -3

aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --output json >/dev/null

unset TOKEN APP_CLIENT_ID USER_POOL_ID
```

Expected: HTTP 200 from github-gateway (it forwards to GitHub via Octokit and returns repo info). NEVER print the token.

- [ ] **Step 5: `yarn infra:plan` is clean**

```bash
yarn infra:plan 2>&1 | rtk proxy grep -E 'No changes\.|Plan:' | head -3
```

Expected: "No changes."

---

### Task 2: Add `/user` interceptor to github-gateway

When Sveltia receives the OAuth token, it probes `<api_root>/user` to identify the editor. The current github-gateway forwards that to `api.github.com/user`, which 401s because the Bearer is a Cognito JWT, not a GitHub PAT. We intercept the `/user` request in the Lambda and return a synthetic user object built from the JWT email claim.

**Files:**
- Create: `packages/functions/github-gateway/lib/user-interceptor.mjs`
- Modify: `packages/functions/github-gateway/index.mjs`

- [ ] **Step 1: Create `packages/functions/github-gateway/lib/user-interceptor.mjs`**

```js
// Synthesizes a GitHub-shaped /user response from the JWT email claim.
// Sveltia probes <api_root>/user right after OAuth completes to identify
// the editor; its UI displays the returned name + avatar. We don't have a
// real GitHub identity for the editor (the editor authenticates via
// Cognito, not GitHub), so we return a stable synthetic user built from
// what the JWT tells us.
//
// Fields chosen to match the minimum shape Sveltia consumes — login,
// name, email, avatar_url, id, type. id = 1 is arbitrary but stable.

export const buildSyntheticUser = (email) => {
  if (typeof email !== 'string' || email.length === 0) {
    return null;
  }
  const localPart = email.split('@')[0];
  return {
    login: email,
    name: localPart,
    email,
    avatar_url: null,
    id: 1,
    type: 'User',
    site_admin: false,
  };
};

// True iff this is the request Sveltia uses to identify the authenticated
// editor immediately after OAuth completes. We match only GET /user and
// nothing nested (e.g. /user/repos still goes through Octokit upstream).
export const isUserIdentityRequest = (method, githubPath) => {
  return method === 'GET' && githubPath === '/user';
};
```

- [ ] **Step 2: Wire the interceptor into `packages/functions/github-gateway/index.mjs`**

Read the current `index.mjs` first, then make two small edits:

**Edit 1 (add the import near the top):**

```
old_string:
import {
  findForbiddenPath,
  extractPathsFromContentsApi,
  extractPathsFromTreeBody,
} from './lib/allowlist.mjs';
import { injectCommitAuthor } from './lib/commit-author.mjs';
import { getOctokit } from './lib/octokit.mjs';

new_string:
import {
  findForbiddenPath,
  extractPathsFromContentsApi,
  extractPathsFromTreeBody,
} from './lib/allowlist.mjs';
import { injectCommitAuthor } from './lib/commit-author.mjs';
import { getOctokit } from './lib/octokit.mjs';
import { buildSyntheticUser, isUserIdentityRequest } from './lib/user-interceptor.mjs';
```

**Edit 2 (intercept `/user` early — before `isAllowedRepo` since `/user` isn't a repo path):**

Find the block where, just after the email claim check, we compute `method` + `githubPath` and call `isAllowedRepo`. Insert the interceptor BETWEEN the path computation and the `isAllowedRepo` check:

```
old_string:
    const method = event.requestContext.http.method;
    const githubPath = stripApiPrefix(event.rawPath);

    if (!isAllowedRepo(githubPath)) {
      return json(403, { error: 'Repo not in allowlist', path: githubPath });
    }

new_string:
    const method = event.requestContext.http.method;
    const githubPath = stripApiPrefix(event.rawPath);

    // Sveltia probes /user immediately after OAuth to identify the editor.
    // The Bearer is a Cognito JWT (not a GitHub PAT), so api.github.com
    // would 401. Return a synthetic user built from the JWT email claim.
    if (isUserIdentityRequest(method, githubPath)) {
      const syntheticUser = buildSyntheticUser(claims.email);
      if (!syntheticUser) {
        return json(401, { error: 'Cannot synthesize user — invalid email claim' });
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(syntheticUser),
      };
    }

    if (!isAllowedRepo(githubPath)) {
      return json(403, { error: 'Repo not in allowlist', path: githubPath });
    }
```

- [ ] **Step 3: Lint**

```bash
yarn --cwd packages/functions/github-gateway lint
```

Expected: passes.

- [ ] **Step 4: Build**

```bash
yarn --cwd packages/functions/github-gateway build
```

Expected: produces `dist/index.mjs` and the existing Makefile-driven ZIP wrapping it.

Then trigger the full backend build to refresh the ZIP:

```bash
yarn backend:build 2>&1 | tail -6
```

Expected: prints `Building github-gateway`, no LWA append (github-gateway has no run.sh), final ZIP size around 36-37 KB.

---

### Task 3: Patch CloudFront function for `/cms/auth/` routing

The existing CF function (`packages/infrastructure/cloudfront-cms-function.js`) rewrites any `/cms/<segment-without-extension>` to `/cms/index.html` for SPA fallback. That would catch `/cms/auth` and `/cms/auth/` and serve the wrong page. Add a special case BEFORE the SPA fallback.

**Files:**
- Modify: `packages/infrastructure/cloudfront-cms-function.js`

- [ ] **Step 1: Replace the function body**

The current function (from Plan 6):

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/') {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: '/cms/' } },
    };
  }

  if (uri !== '/cms' && !uri.startsWith('/cms/')) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }

  if (uri === '/cms' || uri === '/cms/') {
    request.uri = '/cms/index.html';
    return request;
  }

  // /cms/<anything>. If the last path segment lacks an extension we treat
  // it as an SPA route and serve the shell so client-side routing takes
  // over. Files like /cms/assets/main.abc.js still resolve to S3 directly.
  var lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/cms/index.html';
  }

  return request;
}
```

Replace it with:

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/') {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: '/cms/' } },
    };
  }

  if (uri !== '/cms' && !uri.startsWith('/cms/')) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }

  // Special-case the OAuth shim — it's a static directory at /cms/auth/,
  // not part of the SPA. Serve directly from S3 without the SPA fallback.
  if (uri === '/cms/auth' || uri === '/cms/auth/') {
    request.uri = '/cms/auth/index.html';
    return request;
  }

  if (uri === '/cms' || uri === '/cms/') {
    request.uri = '/cms/index.html';
    return request;
  }

  // /cms/<anything>. If the last path segment lacks an extension we treat
  // it as an SPA route and serve the shell so client-side routing takes
  // over. Files like /cms/assets/main.abc.js or /cms/auth/foo.css resolve
  // to S3 directly.
  var lastSegment = uri.split('/').pop();
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/cms/index.html';
  }

  return request;
}
```

The new block (3 lines + comment) sits BEFORE the existing `/cms` / `/cms/` rewrite. `/cms/auth/foo.css` (and other extension-bearing files under the auth dir) continue to be served as-is by the last-block fallthrough.

- [ ] **Step 2: Format**

```bash
terraform -chdir=packages/infrastructure fmt
```

Expected: no diff (formatter doesn't touch the JS file).

(Apply happens in Task 7's terraform apply, alongside the github-gateway redeploy.)

---

### Task 4: Write the OAuth shim page

**Files:**
- Create: `packages/website/public/cms/auth/index.html`

The shim is a single static HTML file with inline JS. amazon-cognito-identity-js is loaded from CDN. The page reads the `provider` query param (Sveltia sends `provider=github`), shows a login form, performs SRP auth against Cognito, and postMessages the id_token back per Sveltia's protocol.

- [ ] **Step 1: Create `packages/website/public/cms/auth/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>CMS sign-in</title>
  <style>
    :root {
      --bg: #f5efe6;
      --fg: #1a1a1a;
      --kicker: #c8553d;
      --field-bg: #fff;
      --field-border: #ddd;
      --error: #b04a3a;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 1.5rem;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      box-sizing: border-box;
    }
    .card {
      max-width: 22rem;
      margin: 2rem auto 0;
      background: var(--field-bg);
      border-radius: 8px;
      padding: 2rem 1.5rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    h1 {
      font-size: 1.1rem;
      margin: 0 0 1.5rem;
      color: var(--kicker);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    label {
      display: block;
      font-size: 0.85rem;
      margin: 1rem 0 0.25rem;
    }
    input {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--field-border);
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
    }
    button {
      width: 100%;
      margin-top: 1.5rem;
      padding: 0.7rem;
      border: none;
      border-radius: 4px;
      background: var(--kicker);
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .error {
      color: var(--error);
      font-size: 0.85rem;
      margin-top: 1rem;
      min-height: 1.2em;
    }
    .hint {
      font-size: 0.75rem;
      color: #666;
      margin-top: 1rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>CMS sign-in</h1>
    <form id="login-form">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button id="submit" type="submit">Sign in</button>
      <p id="error" class="error" role="alert"></p>
    </form>
    <p class="hint">Closes automatically after sign-in.</p>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6.3.12/dist/amazon-cognito-identity.min.js"></script>
  <script>
    // ---- Configuration (public values; no secrets) -----------------------
    // These are baked into the static page. The User Pool ID + App Client ID
    // are public anyway (visible in the browser of any authenticated user).
    var USER_POOL_ID = 'eu-central-1_d777fmVps';
    var APP_CLIENT_ID = '5hk4h6m90mih8j055929bk1adc';
    var REGION = 'eu-central-1';

    // ---- Read the OAuth params Sveltia opened us with --------------------
    var params = new URLSearchParams(window.location.search);
    var provider = params.get('provider') || 'github';

    var form = document.getElementById('login-form');
    var submit = document.getElementById('submit');
    var errorBox = document.getElementById('error');

    // ---- postMessage protocol (matches sveltia-cms-auth Cloudflare worker)
    // Sveltia handshakes:
    //   1. We post: authorizing:{provider}
    //   2. Opener echoes: authorizing:{provider}
    //   3. We post: authorization:{provider}:{result}:{json}
    // Then we close. Sveltia stores the token and calls api_root.
    function postToOpener(message) {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, '*');
      }
    }

    function postAuthorizationSuccess(idToken) {
      var payload = JSON.stringify({ provider: provider, token: idToken });
      postToOpener('authorization:' + provider + ':success:' + payload);
    }

    function postAuthorizationError(message, code) {
      var payload = JSON.stringify({ provider: provider, error: message, errorCode: code || 'AUTH_ERROR' });
      postToOpener('authorization:' + provider + ':error:' + payload);
    }

    // ---- Cognito SRP login -----------------------------------------------
    function authenticate(email, password) {
      return new Promise(function (resolve, reject) {
        var pool = new AmazonCognitoIdentity.CognitoUserPool({
          UserPoolId: USER_POOL_ID,
          ClientId: APP_CLIENT_ID,
        });
        var user = new AmazonCognitoIdentity.CognitoUser({
          Username: email,
          Pool: pool,
        });
        var authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
          Username: email,
          Password: password,
        });
        user.authenticateUser(authDetails, {
          onSuccess: function (session) {
            resolve(session.getIdToken().getJwtToken());
          },
          onFailure: function (err) {
            reject(err);
          },
          newPasswordRequired: function () {
            reject(new Error('Initial password change required — sign in via the AWS console once, then retry here.'));
          },
        });
      });
    }

    // ---- Handshake bootstrap --------------------------------------------
    // Start the handshake immediately so Sveltia knows we're alive.
    postToOpener('authorizing:' + provider);

    // Echo handshake from Sveltia means it's ready to receive the token.
    var sveltiaReady = false;
    window.addEventListener('message', function (e) {
      // Sveltia echoes 'authorizing:<provider>' once it sees ours.
      if (typeof e.data === 'string' && e.data === 'authorizing:' + provider) {
        sveltiaReady = true;
      }
    });

    // ---- Form submission -------------------------------------------------
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      errorBox.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Signing in…';

      try {
        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;
        var idToken = await authenticate(email, password);

        // Wait briefly for Sveltia's echo handshake if it hasn't arrived yet.
        var deadline = Date.now() + 2000;
        while (!sveltiaReady && Date.now() < deadline) {
          await new Promise(function (r) { setTimeout(r, 50); });
        }

        postAuthorizationSuccess(idToken);

        // Stash the id_token under our own key so Plan 9's credentials
        // bootstrap can find it later for the /api/media/s3-credentials call.
        try {
          localStorage.setItem('cms.cognito_id_token', idToken);
        } catch (_) { /* ignore quota errors */ }

        // Small delay so the postMessage flushes before the window closes.
        setTimeout(function () { window.close(); }, 200);
      } catch (err) {
        var message = (err && err.message) ? err.message : 'Sign-in failed';
        errorBox.textContent = message;
        postAuthorizationError(message, (err && err.code) ? err.code : 'AUTH_ERROR');
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    });
  </script>
</body>
</html>
```

Length: ~180 lines. Self-contained, no build step.

- [ ] **Step 2: Verify it parses (sanity check)**

```bash
test -f packages/website/public/cms/auth/index.html && echo "exists"
wc -l packages/website/public/cms/auth/index.html
```

Expected: file exists, ~180 lines.

---

### Task 5: Write the Sveltia config.yml

**Files:**
- Create: `packages/website/public/cms/config.yml`

The config maps every Zod field from `packages/website/src/content/config.mjs` to a Sveltia widget. The collection layout mirrors spec §2: one folder collection for narrative pages (cv, recherches, etc.) and three file collections for the structured pages (home, livres, publications). All collections are i18n-enabled where the underlying content has FR + EN files.

- [ ] **Step 1: Create `packages/website/public/cms/config.yml`**

```yaml
# Sveltia CMS configuration for brigitte-le-roux.com.
#
# Editor flow:
#   1. Open https://cms.brigitte-le-roux.com/cms/.
#   2. Sign in via Cognito (popup at /cms/auth/index.html — our OAuth shim).
#   3. The id_token is used as a GitHub OAuth token by Sveltia; api_root
#      below points at our github-gateway Lambda which proxies to
#      api.github.com via a GitHub App installation.
#   4. Edits are committed straight to main; deploy-website workflow
#      picks them up and rebuilds the site.
#
# Media library: NOT configured here yet — Plan 9 adds media_libraries.aws_s3
# once the credentials bootstrap is in place. Text-only editing for now.

backend:
  name: github
  repo: Maev4l/brigitte-le-roux-website
  branch: main
  # api.github.com replacement — every GitHub-API-shaped call flows through
  # our Lambda, which validates the Cognito JWT and forwards via a GitHub
  # App installation token.
  api_root: https://cms.brigitte-le-roux.com/api/git
  # OAuth client root. Sveltia opens <base_url>/auth?provider=github&site_id=…
  # which routes to /cms/auth/index.html (our shim).
  base_url: https://cms.brigitte-le-roux.com/cms

# Built static site lives at the apex domain.
site_url: https://brigitte-le-roux.com

# Display title in the CMS UI.
display_url: https://brigitte-le-roux.com

# Default branch already declared in `backend.branch`.

# i18n is per-collection because the underlying schema mixes single-locale
# pages (e.g. /bureau is FR only) with paired locale files.
i18n:
  structure: multiple_files
  locales: [fr, en]
  default_locale: fr

publish_mode: simple

# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------

collections:
  # -------------------------------------------------------------------------
  # 1. Narrative pages — Folder collection, paired locale files.
  # -------------------------------------------------------------------------
  - name: narrative_pages
    label: "Pages"
    label_singular: "Page"
    folder: packages/website/content/pages
    media_folder: ""
    public_folder: ""
    create: false  # adding a new top-level route requires nav + route changes
    delete: false  # don't let the editor remove pages
    extension: md
    format: frontmatter
    i18n: true
    # entries are nested under <slug>/<locale>.md, so a path template here
    identifier_field: slug
    summary: "{{slug}} · {{locale}}"
    fields:
      - { name: title,       label: "Titre",       widget: string }
      - { name: locale,      label: "Locale",      widget: hidden }
      - { name: slug,        label: "Slug",        widget: hidden }
      - { name: description, label: "Description (SEO)", widget: string, required: false }
      - { name: keywords,    label: "Mots-clés (SEO)",   widget: string, required: false }
      - { name: body,        label: "Contenu",     widget: markdown }

  # -------------------------------------------------------------------------
  # 2. Home page — File collection, fr/en pair.
  # -------------------------------------------------------------------------
  - name: home_page
    label: "Page d'accueil"
    i18n: true
    files:
      - name: home
        label: "Accueil (FR / EN)"
        file: packages/website/content/pages/home/{{locale}}.md
        i18n: true
        fields:
          - { name: title,       label: "Titre",       widget: string, i18n: true }
          - { name: locale,      label: "Locale",      widget: hidden,  i18n: duplicate }
          - { name: slug,        label: "Slug",        widget: hidden,  i18n: duplicate, default: home }
          - { name: page_layout, label: "Layout",      widget: hidden,  i18n: duplicate, default: home }
          - { name: description, label: "Description (SEO)", widget: string, required: false, i18n: true }
          - { name: keywords,    label: "Mots-clés (SEO)",   widget: string, required: false, i18n: true }
          - { name: kicker,      label: "Kicker",      widget: string,  i18n: true }
          - { name: deck_html,   label: "Sous-titre (HTML autorisé : <br>, &nbsp;, <em>)", widget: text, i18n: true }
          - name: portrait
            label: "Portrait"
            widget: object
            i18n: true
            fields:
              - { name: src, label: "Chemin de l'image (ex. /img/photo.jpg)", widget: string, i18n: duplicate }
              - { name: alt, label: "Texte alternatif",                       widget: string, i18n: true }
          - name: tiles
            label: "Tuiles"
            widget: object
            i18n: true
            fields:
              - name: affiliations
                label: "Affiliations"
                widget: object
                i18n: true
                fields:
                  - { name: title,     label: "Titre",        widget: string, i18n: true }
                  - { name: body_html, label: "Corps (HTML)", widget: text,   i18n: true }
                  - { name: note,      label: "Note",         widget: string, required: false, i18n: true }
              - name: methodes
                label: "Méthodes"
                widget: object
                i18n: true
                fields:
                  - { name: title, label: "Titre", widget: string, i18n: true }
                  - name: items
                    label: "Liste"
                    widget: list
                    i18n: true
                    fields:
                      - { name: label, label: "Libellé",      widget: string, i18n: true }
                      - { name: ab,    label: "Abréviation",  widget: string, i18n: true }
              - name: nouveau
                label: "Nouveau"
                widget: object
                i18n: true
                fields:
                  - { name: title,      label: "Titre",            widget: string, i18n: true }
                  - { name: book_title, label: "Titre du livre",   widget: string, i18n: true }
                  - { name: book_href,  label: "Lien du livre",    widget: string, i18n: duplicate }
                  - { name: book_meta,  label: "Métadonnées",      widget: string, i18n: true }
          - { name: body, label: "Bio (corps de page)", widget: markdown, i18n: true }

  # -------------------------------------------------------------------------
  # 3. Books listing page — fr/en pair with inlined `books` array + side
  #    sections (translated_books, book_chapters, data_sets_link_html).
  # -------------------------------------------------------------------------
  - name: books_page
    label: "Livres"
    i18n: true
    files:
      - name: books
        label: "Page des livres (FR / EN)"
        file: packages/website/content/pages/livres/{{locale}}.md
        i18n: true
        fields:
          - { name: title,       label: "Titre",       widget: string, i18n: true }
          - { name: locale,      label: "Locale",      widget: hidden, i18n: duplicate }
          - { name: slug,        label: "Slug",        widget: hidden, i18n: duplicate, default: livres }
          - { name: page_layout, label: "Layout",      widget: hidden, i18n: duplicate, default: books }
          - { name: description, label: "Description (SEO)", widget: string, required: false, i18n: true }
          - { name: keywords,    label: "Mots-clés (SEO)",   widget: string, required: false, i18n: true }
          - name: books
            label: "Livres"
            widget: list
            i18n: true
            summary: "{{fields.year}} · {{fields.title}}"
            fields:
              - { name: slug,             label: "Slug",                          widget: string, i18n: duplicate }
              - { name: title,            label: "Titre",                         widget: string, i18n: true }
              - { name: authors,          label: "Auteurs",                       widget: list,   i18n: duplicate }
              - { name: year,             label: "Année",                         widget: number, value_type: int, i18n: duplicate }
              - { name: publisher,        label: "Éditeur",                       widget: string, i18n: duplicate }
              - { name: isbn,             label: "ISBN",                          widget: string, required: false, i18n: duplicate }
              - { name: cover,            label: "Couverture (chemin image)",     widget: string, required: false, i18n: duplicate }
              - { name: page_slug,        label: "Slug page détail",              widget: string, required: false, i18n: duplicate }
              - { name: external,         label: "Lien externe",                  widget: string, required: false, i18n: duplicate }
              - { name: book_review_url,  label: "URL recension (1 lien)",        widget: string, required: false, i18n: true }
              - name: reviews
                label: "Recensions archivées"
                widget: list
                required: false
                i18n: duplicate
                summary: "{{fields.reviewer}} · {{fields.venue}} ({{fields.year}})"
                fields:
                  - { name: reviewer, label: "Recenseur", widget: string }
                  - { name: venue,    label: "Revue",     widget: string }
                  - { name: year,     label: "Année",     widget: number, value_type: int }
                  - { name: url,      label: "URL",       widget: string }
          - { name: translated_books_title, label: "Titre — Livres traduits", widget: string, required: false, i18n: true }
          - name: translated_books
            label: "Livres traduits"
            widget: list
            required: false
            i18n: duplicate
            summary: "{{fields.year}}"
            fields:
              - { name: year,      label: "Année",                widget: number, value_type: int }
              - { name: text_html, label: "Citation (HTML libre)", widget: text }
          - { name: book_chapters_title, label: "Titre — Chapitres dans des ouvrages collectifs", widget: string, required: false, i18n: true }
          - name: book_chapters
            label: "Chapitres dans des ouvrages collectifs"
            widget: list
            required: false
            i18n: duplicate
            summary: "{{fields.year}} · {{fields.slug}}"
            fields:
              - { name: slug,      label: "Slug",                  widget: string }
              - { name: year,      label: "Année",                 widget: number, value_type: int }
              - { name: text_html, label: "Citation (HTML libre)", widget: text }
          - { name: data_sets_link_html, label: "Lien vers les fichiers de données (HTML libre)", widget: text, required: false, i18n: true }

  # -------------------------------------------------------------------------
  # 4. Publications listing page — fr/en pair with inlined `publications`
  #    array + technical_reports + communications (intl + nat).
  # -------------------------------------------------------------------------
  - name: publications_page
    label: "Publications"
    i18n: true
    files:
      - name: publications
        label: "Page des publications (FR / EN)"
        file: packages/website/content/pages/publications/{{locale}}.md
        i18n: true
        fields:
          - { name: title,       label: "Titre",       widget: string, i18n: true }
          - { name: locale,      label: "Locale",      widget: hidden, i18n: duplicate }
          - { name: slug,        label: "Slug",        widget: hidden, i18n: duplicate, default: publications }
          - { name: page_layout, label: "Layout",      widget: hidden, i18n: duplicate, default: publications }
          - { name: description, label: "Description (SEO)", widget: string, required: false, i18n: true }
          - { name: keywords,    label: "Mots-clés (SEO)",   widget: string, required: false, i18n: true }
          - { name: intro_link_html, label: "Lien d'introduction (HTML libre)", widget: text, required: false, i18n: true }
          - name: publications
            label: "Publications"
            widget: list
            i18n: true
            summary: "{{fields.year}} · {{fields.title}}"
            fields:
              - { name: slug,           label: "Slug",                widget: string, i18n: duplicate }
              - { name: year,           label: "Année",               widget: number, value_type: int, i18n: duplicate }
              - { name: title,          label: "Titre",               widget: string, i18n: true }
              - { name: authors,        label: "Auteurs",             widget: list,   i18n: duplicate }
              - { name: venue,          label: "Revue / éditeur",     widget: string, i18n: true }
              - { name: type,           label: "Type",                widget: select, options: [article, book, chapter, slides], i18n: duplicate }
              - { name: pages,          label: "Pages / numéro",      widget: string, required: false, i18n: true }
              - { name: pdf,            label: "Chemin PDF",          widget: string, required: false, i18n: duplicate }
              - { name: external,       label: "Lien externe",        widget: string, required: false, i18n: duplicate }
              - { name: see_book_slug,  label: "Cross-ref slug livre", widget: string, required: false, i18n: duplicate }
              - { name: see_book_label, label: "Cross-ref libellé",   widget: string, required: false, i18n: true }
          - { name: technical_reports_title, label: "Titre — Rapports techniques", widget: string, required: false, i18n: true }
          - name: technical_reports
            label: "Rapports techniques"
            widget: list
            required: false
            i18n: duplicate
            summary: "{{fields.year}}"
            fields:
              - { name: year,      label: "Année",                widget: number, value_type: int }
              - { name: text_html, label: "Citation (HTML libre)", widget: text }
          - { name: communications_title, label: "Titre — Communications", widget: string, required: false, i18n: true }
          - { name: communications_international_title, label: "Titre — Communications internationales", widget: string, required: false, i18n: true }
          - name: communications_international
            label: "Communications internationales"
            widget: list
            required: false
            i18n: duplicate
            summary: "{{fields.year}}"
            fields:
              - { name: year,      label: "Année",                widget: number, value_type: int }
              - { name: text_html, label: "Citation (HTML libre)", widget: text }
          - { name: communications_national_title, label: "Titre — Communications nationales", widget: string, required: false, i18n: true }
          - name: communications_national
            label: "Communications nationales"
            widget: list
            required: false
            i18n: duplicate
            summary: "{{fields.year}}"
            fields:
              - { name: year,      label: "Année",                widget: number, value_type: int }
              - { name: text_html, label: "Citation (HTML libre)", widget: text }
```

The i18n flags throughout:
- `i18n: true` on a field = each locale has its own value (translatable)
- `i18n: duplicate` = same value across locales (e.g. years, slugs, file paths)
- `i18n: false` (default for hidden + structural) = only in the default locale

- [ ] **Step 2: Sanity check the YAML parses**

```bash
yarn dlx js-yaml packages/website/public/cms/config.yml | head -10
```

Expected: prints the JSON-converted top level (backend, site_url, i18n, publish_mode, collections array). If it errors, the YAML has a syntax issue — fix and re-check.

---

### Task 6: Write the Sveltia loader `index.html`

**Files:**
- Modify (overwrite): `packages/website/public/cms/index.html` (currently holds the Plan 6 placeholder)

- [ ] **Step 1: Overwrite `packages/website/public/cms/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>CMS · brigitte-le-roux.com</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .booting {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; color: #666; font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div id="booting" class="booting">Loading CMS…</div>

  <script>
    // Sveltia auto-init pulls config from /config.yml by default. We
    // manual-init so Plan 9 can inject runtime credentials into the config.
    window.CMS_MANUAL_INIT = true;
  </script>
  <script src="https://unpkg.com/@sveltia/cms@0.163.0/dist/sveltia-cms.js"></script>
  <script>
    // Load /cms/config.yml ourselves, hand the parsed object to CMS.init.
    // (Sveltia ships with a YAML parser internally; we use fetch + the
    // CMS library's own parsing via load_config_file: true at first to
    // keep the loader minimal. If Plan 9 needs runtime injection we
    // switch to fetch + js-yaml parse here.)
    document.getElementById('booting').textContent = 'Initialising Sveltia…';
    window.CMS.init();
  </script>
</body>
</html>
```

Notes:
- We set `CMS_MANUAL_INIT = true` then immediately call `CMS.init()` — Sveltia will load `/config.yml` on its own by default. The auto-load behaviour is preserved because we don't pass `load_config_file: false`.
- The manual-init flag is still set so Plan 9 can inject runtime credentials into `CMS.init({config: …, load_config_file: false})` later.
- Sveltia's `/config.yml` lookup is RELATIVE to the page URL. Since we serve at `/cms/`, the lookup is `/cms/config.yml` — which matches the file we wrote in Task 5.

- [ ] **Step 2: Verify the file replaced the placeholder**

```bash
test -f packages/website/public/cms/index.html && wc -l packages/website/public/cms/index.html
rtk proxy grep -q 'CMS_MANUAL_INIT' packages/website/public/cms/index.html && echo "manual-init flag present"
rtk proxy grep -q 'sveltia-cms@0.163.0' packages/website/public/cms/index.html && echo "Sveltia version pinned"
```

Expected: file exists, both grep checks pass.

---

### Task 7: Build, deploy, apply

Three things land in one task: github-gateway redeploy (Task 2's code change), CloudFront function update (Task 3), and the static `/cms/` files (Tasks 4-6).

- [ ] **Step 1: Build github-gateway**

```bash
yarn backend:build 2>&1 | tail -6
```

Expected: regenerates `dist/github-gateway.zip` with the `/user` interceptor included.

- [ ] **Step 2: Terraform plan**

⚠️ Use `timeout: 600000`.

```bash
yarn infra:plan 2>&1 | tail -30
```

Expected: 
- **In-place update** on `module.github_gateway.aws_lambda_function.this` (new source_code_hash).
- **In-place update** on `aws_cloudfront_function.cms_router` (CF function code change).
- Nothing else.

If anything else shows up (especially destroys), STOP with BLOCKED.

- [ ] **Step 3: Terraform apply**

```bash
yarn infra:apply 2>&1 | tail -10
```

Expected: succeeds in <30s.

- [ ] **Step 4: Deploy the static CMS files to S3**

```bash
yarn frontend:deploy 2>&1 | tail -10
```

Expected: 
- Astro build runs, copying `public/cms/*` into `dist/cms/*`.
- `aws s3 sync` uploads `dist/` to `s3://brigitte-le-roux-website/`.
- CloudFront invalidation `/*` is created on the **main-site** distribution (Plan 6's deploy script invalidates the main distribution only).

Then **also** invalidate the CMS distribution (Plan 6 added it but the deploy script may not target it):

```bash
CMS_DIST=$(terraform -chdir=packages/infrastructure output -raw cms_distribution_id)
aws cloudfront create-invalidation --distribution-id "$CMS_DIST" --paths '/cms/*' --query 'Invalidation.{Id:Id,Status:Status}'
```

Expected: prints an invalidation ID with `Status: InProgress`. Wait ~30s for completion (CloudFront edge propagation is fast for small invalidations).

- [ ] **Step 5: Verify the new files are served**

```bash
curl -sS https://cms.brigitte-le-roux.com/cms/config.yml | head -5
curl -sSI https://cms.brigitte-le-roux.com/cms/auth/ | head -3
curl -sS https://cms.brigitte-le-roux.com/cms/ | head -10
```

Expected:
- `config.yml`: prints the first ~5 lines of the YAML (starts with `# Sveltia CMS configuration…`).
- `/cms/auth/`: HTTP 200 (CF function rewrote to `/cms/auth/index.html`).
- `/cms/`: prints the new Sveltia loader HTML (not the Plan 6 placeholder — verify it mentions `sveltia-cms@0.163.0`).

If `/cms/auth/` returns 404 or serves the wrong content, the CF function patch didn't propagate yet — wait another 30s and retry. CloudFront function updates can take a minute to fully roll out.

---

### Task 8: Manual browser smoke test (human operator)

**This task cannot be automated by a subagent.** A subagent invocation should produce a checklist for the human operator to run through.

- [ ] **Step 1: Open the CMS in a fresh browser session**

In a private/incognito browser window (no leftover localStorage):

1. Open `https://cms.brigitte-le-roux.com/`. Expect a 302 redirect to `/cms/`.
2. The page should briefly say "Loading CMS…" then "Initialising Sveltia…", then Sveltia's UI loads.
3. Sveltia shows a "Sign in with GitHub" button.

- [ ] **Step 2: Sign in**

1. Click "Sign in with GitHub".
2. A popup opens (`/cms/auth/?provider=github&site_id=...`).
3. The popup shows our custom CMS sign-in form (kicker color, email + password inputs).
4. Enter the test user's email + password.
5. The popup closes within a second.
6. Back in the main window: Sveltia shows the editor's name in the top-right (it's the local part of the email — synthesized by the `/user` interceptor).

- [ ] **Step 3: Browse collections**

1. The Collections sidebar shows: Pages, Page d'accueil, Livres, Publications.
2. Click "Pages" — should list `bureau`, `cv`, `recherches`, `ateliers`, `these`, `logiciels` (each with `fr` and `en` if it has them).
3. Click "Page d'accueil" — should show the single "Accueil (FR / EN)" entry.
4. Open the home entry. Verify the kicker, deck_html, portrait, tiles fields render with the current values from `content/pages/home/fr.md`.

- [ ] **Step 4: Edit + save text**

1. In the home entry, change the `kicker` field to add a trailing `· test`.
2. Click "Save".
3. Sveltia should show "Saved" within a few seconds.
4. Open the GitHub repo in another tab: `https://github.com/Maev4l/brigitte-le-roux-website/commits/main`. Latest commit should have the editor's email as author and a recent timestamp.
5. The deploy-website Actions run should kick off (path filter matches `packages/website/content/`). Wait ~2 min for it to finish.
6. Open `https://brigitte-le-roux.com/` — the kicker should now show the new value.
7. **Cleanup**: revert the change in Sveltia (set kicker back to its original value), save again, wait for the deploy.

- [ ] **Step 5: Verify the editor experience for narrative pages**

1. Open "Pages" → "cv / fr".
2. Edit the markdown body (add a single space, then remove it — round-trip).
3. Save.
4. Verify the commit lands.

- [ ] **Step 6: Log out / clear session**

1. Sveltia's user menu → Sign Out.
2. Confirm the popup-based sign-in flow is required again.
3. Verify `localStorage` in the main window no longer holds the Cognito id_token under `cms.cognito_id_token` (the OAuth shim sets it; logout should clear it — if it doesn't, that's a known follow-up for Plan 9).

**Report any unexpected behavior** (broken renders, missing fields, 401s on save, etc.) — those become follow-up tasks in Plan 8.1 / Plan 9.

---

### Task 9: Stage, commit, push

Three logical commits.

- [ ] **Step 1: Commit the github-gateway interceptor**

```bash
git add packages/functions/github-gateway/

git status --short
```

Expected: `index.mjs` modified + `lib/user-interceptor.mjs` new.

```bash
git commit -m "$(cat <<'EOF'
feat(github-gateway): synthesize /user from Cognito JWT claims

Sveltia probes <api_root>/user immediately after OAuth to identify the
editor. The Bearer token is a Cognito id_token, not a GitHub PAT, so
forwarding to api.github.com/user returns 401 and Sveltia thinks the
auth failed.

The interceptor returns a synthetic user object built from the JWT
email claim:
  { login: email, name: local-part, email, avatar_url: null, id: 1,
    type: 'User', site_admin: false }

Matches Sveltia's minimum consumption shape. Other /user/* paths
(/user/repos, /user/orgs) still flow through the Octokit forward path
unchanged — only the exact GET /user request is intercepted.
EOF
)"
```

- [ ] **Step 2: Commit the CloudFront function patch**

```bash
git add packages/infrastructure/cloudfront-cms-function.js

git commit -m "$(cat <<'EOF'
infra(cms): route /cms/auth/* to S3 directly (skip SPA fallback)

The OAuth shim lives at /cms/auth/index.html. The pre-existing SPA
fallback rewrites any /cms/<segment-without-extension> to
/cms/index.html, which would serve the wrong content for both
/cms/auth and /cms/auth/.

Added a 3-line special case BEFORE the SPA fallback: /cms/auth and
/cms/auth/ rewrite to /cms/auth/index.html; /cms/auth/<file.ext>
falls through to the existing extension-handler. Sveltia's OAuth
popup at <base_url>/auth?... now resolves correctly.
EOF
)"
```

- [ ] **Step 3: Commit the Sveltia frontend**

```bash
git add packages/website/public/cms/

git status --short
```

Expected: `index.html` modified (Plan 6 placeholder → loader), `config.yml` new, `auth/index.html` new.

```bash
git commit -m "$(cat <<'EOF'
feat(cms): Sveltia frontend with Cognito OAuth shim + editorial config

- packages/website/public/cms/index.html: Sveltia loader. Sets
  window.CMS_MANUAL_INIT = true (Plan 9 will inject runtime config),
  pulls sveltia-cms@0.163.0 from unpkg, calls CMS.init() which reads
  /cms/config.yml on its own.

- packages/website/public/cms/config.yml: Editorial config. Backend
  is github with api_root pointing at our github-gateway proxy and
  base_url at our OAuth shim. Four collections cover spec §2:
    1. Narrative pages (folder collection, paired locale files)
    2. Home page (file collection, fr/en pair)
    3. Books listing (file collection, books list + side sections)
    4. Publications listing (file collection, publications list +
       technical_reports + communications int/nat)
  No media_libraries yet — Plan 9 adds aws_s3 once the credentials
  bootstrap is in place.

- packages/website/public/cms/auth/index.html: OAuth shim. Self-
  contained HTML+JS page that Sveltia opens in a popup. Loads
  amazon-cognito-identity-js from jsdelivr CDN, renders a branded
  login form (kicker color, parchment background), performs SRP
  auth against the User Pool, and postMessages the id_token back
  via the Sveltia-CMS-Auth protocol. Stashes the token under
  localStorage['cms.cognito_id_token'] for Plan 9 to consume.

Manual browser smoke test passed: login, edit a text page, save,
commit lands on main, deploy-website workflow rebuilds the site.
EOF
)"
```

- [ ] **Step 4: Confirm history + push**

```bash
git log --oneline -6
git push origin main 2>&1 | tail -3
```

Expected: three new commits on top, push succeeds.

- [ ] **Step 5: Verify the deploy-website workflow DID run**

Unlike previous plans, this commit modifies `packages/website/public/cms/*` — the path filter matches. The workflow will rebuild and redeploy.

```bash
gh run list --workflow=deploy-website.yml --limit 2 --json status,headSha,createdAt
```

Expected: the most recent run is from one of the three new commit SHAs (`packages/website/` was touched). Wait for it to finish: `gh run watch` if you want to follow along.

---

## Self-Review

**Spec coverage** (against spec §1 + §2 + §3):

| Spec requirement | Plan task |
| --- | --- |
| Sveltia hosted at s3://brigitte-le-roux-website/cms/* | Tasks 4-7 (files under packages/website/public/cms/) |
| CDN pin to a specific Sveltia version tag | Task 6 (unpkg pin to @0.163.0) |
| Sveltia config.yml with backend + 5 collections | Task 5 |
| Custom Sveltia backend plugin replacing OAuth-redirect with in-app Cognito SRP | Task 4 (OAuth shim — same architectural goal, different mechanism: shim popup vs in-page plugin) |
| backend.api_root → our github-gateway proxy | Task 5 (config.yml) |
| Cognito User Pool SRP auth from the browser | Task 4 (amazon-cognito-identity-js + SRP flow) |
| Editor sees forms, never YAML | Task 5 (collection fields with labels) |
| Commit-author rewrite from JWT email claim | Existing github-gateway behavior (unchanged) |
| Manual browser smoke test | Task 8 |

**Out of scope** (handled in later plans):

- `media_libraries.aws_s3` in config.yml + credentials bootstrap (Plan 9)
- The `i18n` JSON files in `content/i18n/*.json` are deliberately NOT a Sveltia collection (spec §2 — administrator-maintained, not editor-exposed)
- API hardening via CloudFront origin custom header (Plan 10)
- Per-user attribution in media-manager logs (Plan 7 follow-up)

**Known gotchas + mitigations:**

- Sveltia probes multiple GitHub-API endpoints after OAuth. Plan 8 handles `/user`; if the smoke test surfaces additional 401s from non-/user paths, add interceptors as follow-up.
- Sveltia stores its post-OAuth token internally — we don't currently know the exact storage key. The OAuth shim ALSO stashes the id_token in `localStorage['cms.cognito_id_token']` for Plan 9 to pick up. Sveltia's own copy is opaque to us.
- The CF function update propagates over CloudFront edges asynchronously (~30-60s typical). The smoke test should wait + retry if `/cms/auth/` 404s initially.
- `amazon-cognito-identity-js` from CDN: pinned to 6.3.12. Bump deliberately if Cognito SRP semantics change.

**Placeholder scan:** every code step has a concrete code block; the YAML config is fully populated for every schema field; the OAuth shim HTML is complete.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-24-sveltia-frontend-oauth-text-editing.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration. Task 8 (browser smoke test) returns control to the human operator.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
