# github-gateway Lambda + API Gateway Trigger

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `github-gateway` Lambda — the authenticated proxy between Sveltia and GitHub. Sveltia sends GitHub-API-shaped requests with a Cognito Bearer token; this Lambda validates the JWT (via API Gateway's JWT authorizer, set up here for the first time), enforces a path allowlist, rewrites the commit author to the user's email, mints a short-lived GitHub App installation token, forwards the request to `api.github.com`, and streams the response back.

By the end of this plan, you can `curl` an authenticated request through API Gateway → Lambda → GitHub and see a real commit land in the repo on the user's behalf. Sveltia integration itself comes in Plan 6.

**Architecture:**

```
Sveltia (browser, Plan 6)
   │ Authorization: Bearer <Cognito id_token>
   │ POST /api/git/repos/<owner>/<repo>/contents/<path>
   ▼
API Gateway HTTP API (created in this plan via Maev4l/terraform-modules//modules/lambda-trigger-apigw)
   │ JWT authorizer validates against Cognito User Pool (from Plan 3)
   ▼
github-gateway Lambda (Node.js 22, ZIP)
   ├── reads JWT claims from event.requestContext.authorizer.jwt.claims
   ├── strips the /api/git prefix → path becomes the GitHub-API path
   ├── path allowlist (only paths under packages/website/content/)
   ├── if commit-creating: inject author.name/email from JWT email claim
   ├── reads GitHub App PEM from SSM SecureString (module-load, cached)
   ├── Octokit + createAppAuth: mints 1h installation token (cached)
   └── forwards to api.github.com, streams response back
   ▼
GitHub repo (Maev4l/brigitte-le-roux-website)
   │ push triggers
   ▼
GitHub Actions deploy-website workflow (already wired in Plan 2)
```

**Tech Stack:**
- Node.js 22 ESM (plain JS, no TypeScript, fat-arrow, strict-pinned deps, eslint.config.js).
- Lambda packaged as ZIP (architecture = arm64 / Graviton).
- AWS Lambda runtime `nodejs22.x` (managed).
- Dependencies: `@octokit/rest`, `@octokit/auth-app`, `@aws-sdk/client-ssm`.
- Terraform via `Maev4l/terraform-modules//modules/lambda-function` and `//modules/lambda-trigger-apigw` (v1.7.1 pinned).
- SSM SecureString for the GitHub App private key.

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §3 (github-gateway Lambda + GitHub App + SSM) and §4 (API Gateway + JWT authorizer).

---

## Preconditions

- On `main`, working tree clean.
- Plan 3 has been applied: Cognito User Pool `brigitte-le-roux-website-cms` exists with a confirmed test user. Before Task 8, export the credentials in your shell:
  `export TEST_USER_EMAIL=...; export TEST_USER_PASSWORD=...` (values held outside the repo).
- Dev role has Lambda + API Gateway + SSM IAM permissions (Task 1 probes).
- `gh` CLI authenticated as `Maev4l` with `repo` scope.

## Approach notes

- **Multiple commits** during execution this time (the Lambda code commits are separate from the Terraform commits — easier to bisect and review).
- **Manual GitHub App creation step** in Task 5 (one-off, ~10 min in the GitHub UI). Cannot be automated via Terraform — GitHub Apps are owned by user accounts and created interactively.
- **No push to `main` until everything is verified** (this plan does push, but only at Task 11 after all smoke tests pass).
- The Lambda is exposed at the API Gateway default URL `https://<api-id>.execute-api.eu-central-1.amazonaws.com`. The unified `cms.brigitte-le-roux.com` CloudFront distribution is a later plan; for now we test via the execute-api URL directly.

---

### Task 1: Verify preconditions

- [ ] **Step 1: Branch + clean tree**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty.

- [ ] **Step 2: Confirm Plan 3's Cognito resources are still present**

Run:
```bash
terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id
terraform -chdir=packages/infrastructure output -raw cognito_app_client_id
```

Expected: both print non-empty strings (the User Pool ID and App Client ID landed in Plan 3).

- [ ] **Step 3: Confirm dev role can manage Lambda + SSM + API Gateway**

Run three probe commands:
```bash
aws lambda list-functions --max-items 1 2>&1 | head -3
aws ssm describe-parameters --max-results 1 2>&1 | head -3
aws apigatewayv2 get-apis --max-results 1 2>&1 | head -3
```

Expected: all three succeed (Lambda `Functions: [...]`, SSM `Parameters: [...]`, APIGW `Items: [...]`). If any fails with AccessDenied, stop and resolve.

- [ ] **Step 4: Confirm `gh` is authenticated for the repo**

Run: `gh auth status`

Expected: shows logged-in account with `repo` scope on `Maev4l/brigitte-le-roux-website`.

- [ ] **Step 5: `yarn infra:plan` shows no drift**

Run: `yarn infra:plan 2>&1 | tail -3`

Expected: "No changes."

---

### Task 2: Create the GitHub App (manual, one-time)

The GitHub App is the identity the Lambda assumes when committing to the repo. Owned by your personal account; installed on the repo; the Lambda holds the App's private key (RSA PEM) in SSM.

This task is manual — GitHub Apps cannot be created via Terraform. ~10 min in the GitHub UI.

- [ ] **Step 1: Create the App**

Navigate: GitHub → top-right avatar → **Settings** → left sidebar **Developer settings** → **GitHub Apps** → **New GitHub App**.

Fill in:
- **GitHub App name**: `brigitte-le-roux-website-cms` (must be globally unique; if taken, append a numeric suffix like `-1`).
- **Homepage URL**: `https://brigitte-le-roux.com/`
- **Webhook**: uncheck **Active** (we don't need webhooks).
- **Permissions** → Repository permissions:
  - **Contents**: `Read and write`
  - **Pull requests**: `Read and write`
  - **Metadata**: `Read-only` (default; required)
  - All others: `No access` (default)
- **Where can this GitHub App be installed?**: `Only on this account`

Click **Create GitHub App**.

- [ ] **Step 2: Generate a private key**

On the App's settings page (after creation), scroll down to **Private keys** → click **Generate a private key**.

GitHub downloads a `.pem` file. **Store this file somewhere safe temporarily** — we upload it to SSM in Task 4, then delete the local copy.

- [ ] **Step 3: Note the App ID**

At the top of the App's settings page, copy the **App ID** (an integer like `1234567`). Record it; goes into the Lambda env in Task 6.

- [ ] **Step 4: Install the App on the repo**

Left sidebar **Install App** → click **Install** next to your username (`Maev4l`) → choose **Only select repositories** → select `brigitte-le-roux-website` → click **Install**.

- [ ] **Step 5: Note the Installation ID**

After install, you land on the install settings page. The URL is `https://github.com/settings/installations/<INSTALLATION_ID>`. **Copy the installation ID** from the URL. Goes into the Lambda env in Task 6.

---

### Task 3: Upload the GitHub App private key to SSM Parameter Store

The PEM file from Task 2 Step 2 goes into SSM as a `SecureString`. The Lambda reads it at cold start via `ssm:GetParameter` with `WithDecryption=true`.

All three credentials (App ID, Installation ID, private key) go into a
**single SSM SecureString** as JSON. Keeps the Lambda's cold-start path
to one SSM call, and the IDs benefit from the same encryption/IAM scope
as the PEM.

- [ ] **Step 1: Build the JSON and upload**

Replace `<path-to-pem>`, `<APP_ID>`, and `<INSTALLATION_ID>` with the
values from Task 2.

```bash
PEM=$(cat <path-to-pem>)
JSON=$(jq -n \
  --arg app_id "<APP_ID>" \
  --arg installation_id "<INSTALLATION_ID>" \
  --arg private_key "$PEM" \
  '{app_id: $app_id, installation_id: $installation_id, private_key: $private_key}')

aws ssm put-parameter \
  --name "brigitte-le-roux-website.github-app-secrets" \
  --type "SecureString" \
  --description "GitHub App credentials JSON: { app_id, installation_id, private_key }. Read by the github-gateway Lambda at cold start." \
  --value "$JSON"
```

Expected: returns `{"Version": 1, "Tier": "Standard"}`. The JSON should
be ~1800 chars — well under the 4 KB Standard-tier limit.

If the dev role lacks `ssm:PutParameter`, fall back to the AWS console:
Systems Manager → Parameter Store → Create parameter
(Name: `brigitte-le-roux-website.github-app-secrets`, Type: SecureString,
KMS key: alias/aws/ssm, Value: paste the JSON object as a single line).

- [ ] **Step 2: Verify the parameter exists**

```bash
aws ssm get-parameter \
  --name "brigitte-le-roux-website.github-app-secrets" \
  --with-decryption \
  --query 'Parameter.{Name:Name,Type:Type,Length:length(Value)}'
```

Expected: shows the parameter with a Length around 1800. **DO NOT print
the full Value** — it contains the PEM.

- [ ] **Step 3: Securely delete the local PEM file**

```bash
shred -u <path-to-pem>        # Linux
# or, on macOS:
rm -P <path-to-pem>
```

The PEM is no longer needed anywhere on disk. If it leaks, regenerate it on the GitHub App settings page and re-upload to SSM (rotation procedure).

---

### Task 4: Scaffold the Lambda code

**Files:**
- Create: `packages/functions/github-gateway/package.json`
- Create: `packages/functions/github-gateway/eslint.config.js`
- Create: `packages/functions/github-gateway/index.mjs`
- Create: `packages/functions/github-gateway/lib/octokit.mjs`
- Create: `packages/functions/github-gateway/lib/allowlist.mjs`
- Create: `packages/functions/github-gateway/lib/commit-author.mjs`

- [ ] **Step 1: Create `packages/functions/github-gateway/package.json`**

```json
{
  "name": "github-gateway",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Cognito-authenticated proxy from Sveltia to GitHub via a GitHub App",
  "main": "index.mjs",
  "scripts": {
    "lint": "eslint .",
    "build": "esbuild index.mjs --bundle --platform=node --target=node22 --format=esm --outfile=dist/index.mjs --external:@aws-sdk/* --banner:js=\"import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);\""
  },
  "dependencies": {
    "@aws-sdk/client-ssm": "3.687.0",
    "@octokit/auth-app": "7.1.3",
    "@octokit/rest": "21.0.2"
  },
  "devDependencies": {
    "@eslint/js": "9.15.0",
    "esbuild": "0.24.0",
    "eslint": "9.15.0"
  }
}
```

Strict-pinned versions per the project's global convention (no `^`, no `~`).
`@aws-sdk/*` is bundled-out via esbuild's `--external` flag (provided by
the Lambda runtime); the `banner:js` shim lets bundled CJS deps still
call `require` from within the ESM output.

- [ ] **Step 2: Create `packages/functions/github-gateway/eslint.config.js`**

```js
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
```

- [ ] **Step 3: Create `packages/functions/github-gateway/lib/allowlist.mjs`**

```js
// Path allowlist enforcement. Commits that touch ANY path outside these
// prefixes are rejected with 403 at this gateway — even if the GitHub App
// permissions would technically allow them. Defense in depth: limits the
// blast radius of a compromised Cognito session.

const ALLOWED_PATH_PREFIXES = [
  'packages/website/content/',
];

// Inspect file paths in a commit-creating request body (PUT/POST to
// /repos/{owner}/{repo}/contents/{path}, or batch tree creation).
// Returns null if all paths pass; returns the first offending path otherwise.
export const findForbiddenPath = (paths) => {
  for (const path of paths) {
    if (!ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return path;
    }
  }
  return null;
};

// Extract the file path(s) from a GitHub Contents API request. The contents
// API has the path in the URL itself: /repos/{owner}/{repo}/contents/{path}.
// Returns an array of paths (one for single-file ops, multiple for tree ops).
export const extractPathsFromContentsApi = (urlPath) => {
  const match = urlPath.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
  return match ? [match[1]] : [];
};

// Extract paths from a tree-creation request body. Sveltia uses
// POST /repos/{owner}/{repo}/git/trees for multi-file commits.
export const extractPathsFromTreeBody = (body) => {
  if (!body || !Array.isArray(body.tree)) return [];
  return body.tree.map((entry) => entry.path).filter(Boolean);
};
```

- [ ] **Step 4: Create `packages/functions/github-gateway/lib/commit-author.mjs`**

```js
// Inject the Cognito-authenticated user's email into commit metadata so
// git log attributes the commit to the actual editor, not the GitHub App.

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Sanity-check the email claim from the JWT before stamping it on a commit.
export const validateEmail = (email) => {
  if (typeof email !== 'string') return false;
  if (!EMAIL_PATTERN.test(email)) return false;
  if (email.length > 254) return false;
  return true;
};

// Mutate the body of a Contents API PUT/DELETE request to set author + committer.
// GitHub's API accepts these fields on /repos/{owner}/{repo}/contents/{path}
// for PUT (create or update) and DELETE.
export const injectCommitAuthor = (body, email) => {
  if (!validateEmail(email)) {
    throw new Error('Invalid email claim from JWT');
  }
  const name = email.split('@')[0];
  return {
    ...body,
    author: { name, email },
    committer: { name, email },
  };
};
```

- [ ] **Step 5: Create `packages/functions/github-gateway/lib/octokit.mjs`**

```js
// Octokit client factory. All GitHub App credentials (app_id,
// installation_id, private_key) come from a single SSM SecureString
// parameter containing JSON. Loaded at module load (Lambda cold start),
// cached for the container lifetime. Octokit's auth-app strategy handles
// JWT minting + 1h installation-token refresh transparently.

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

const ssm = new SSMClient({});

let cachedOctokit = null;

const loadAppSecrets = async () => {
  const result = await ssm.send(
    new GetParameterCommand({
      Name: process.env.GITHUB_APP_SECRETS_PARAM,
      WithDecryption: true,
    }),
  );
  return JSON.parse(result.Parameter.Value);
};

export const getOctokit = async () => {
  if (cachedOctokit) return cachedOctokit;
  const { app_id, installation_id, private_key } = await loadAppSecrets();
  cachedOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: app_id,
      privateKey: private_key,
      installationId: installation_id,
    },
  });
  return cachedOctokit;
};
```

- [ ] **Step 6: Create `packages/functions/github-gateway/index.mjs`**

```js
// Lambda handler: receives Sveltia → API Gateway requests, validates,
// authenticates to GitHub via the App, forwards, returns response.
//
// Request shape (from API Gateway HTTP API v2 payload):
// - event.rawPath:    "/api/git/repos/owner/repo/contents/path"
// - event.requestContext.http.method: "PUT" | "POST" | "GET" | "DELETE"
// - event.requestContext.authorizer.jwt.claims: { email, sub, ... }
// - event.body:       JSON string (for PUT/POST/DELETE with body)

import {
  findForbiddenPath,
  extractPathsFromContentsApi,
  extractPathsFromTreeBody,
} from './lib/allowlist.mjs';
import { injectCommitAuthor } from './lib/commit-author.mjs';
import { getOctokit } from './lib/octokit.mjs';

const ALLOWED_REPO = process.env.ALLOWED_REPO; // e.g. "Maev4l/brigitte-le-roux-website"

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const stripApiPrefix = (rawPath) => rawPath.replace(/^\/api\/git/, '');

// Reject requests whose GitHub-API path doesn't target our specific repo.
// Format: /repos/<owner>/<repo>/...
const isAllowedRepo = (githubPath) => {
  const match = githubPath.match(/^\/repos\/([^/]+\/[^/]+)\b/);
  if (!match) return false;
  return match[1] === ALLOWED_REPO;
};

// Decide whether a request creates or modifies content (so we need to
// allowlist-check paths AND inject commit author).
const isContentMutatingRequest = (method, githubPath) => {
  if (method === 'GET' || method === 'HEAD') return false;
  // Contents API: PUT / DELETE.
  if (/^\/repos\/[^/]+\/[^/]+\/contents\//.test(githubPath)) return true;
  // Tree API: POST.
  if (/^\/repos\/[^/]+\/[^/]+\/git\/trees$/.test(githubPath) && method === 'POST') return true;
  // Refs / commits API are how Sveltia builds up multi-file commits.
  // Sveltia's typical flow: create blobs → create tree → create commit →
  // update ref. The path-allowlist check happens at the tree step.
  return false;
};

export const handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.email) {
      return json(401, { error: 'Missing email claim in JWT' });
    }

    const method = event.requestContext.http.method;
    const githubPath = stripApiPrefix(event.rawPath);

    if (!isAllowedRepo(githubPath)) {
      return json(403, { error: 'Repo not in allowlist', path: githubPath });
    }

    const requestBody = event.body ? JSON.parse(event.body) : null;

    // Path allowlist check for content-mutating requests.
    if (isContentMutatingRequest(method, githubPath)) {
      let paths;
      if (/\/contents\//.test(githubPath)) {
        paths = extractPathsFromContentsApi(githubPath);
      } else if (/\/git\/trees$/.test(githubPath) && requestBody) {
        paths = extractPathsFromTreeBody(requestBody);
      } else {
        paths = [];
      }
      const forbidden = findForbiddenPath(paths);
      if (forbidden) {
        return json(403, { error: 'Path not in allowlist', path: forbidden });
      }
    }

    // Commit-author rewrite for Contents API mutations.
    let finalBody = requestBody;
    if (/\/contents\//.test(githubPath) && (method === 'PUT' || method === 'DELETE') && requestBody) {
      finalBody = injectCommitAuthor(requestBody, claims.email);
    }

    // Forward to GitHub.
    const octokit = await getOctokit();
    const response = await octokit.request({
      method,
      url: githubPath,
      data: finalBody,
      headers: { accept: 'application/vnd.github+json' },
    });

    return {
      statusCode: response.status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(response.data),
    };
  } catch (err) {
    // Octokit throws on 4xx/5xx — forward GitHub's status code + message
    // through so Sveltia can react sensibly.
    if (err.status && err.response?.data) {
      return {
        statusCode: err.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(err.response.data),
      };
    }
    console.error('github-gateway error', err);
    return json(502, { error: 'Upstream error', message: err.message });
  }
};
```

- [ ] **Step 7: Install deps**

```bash
yarn --cwd packages/functions/github-gateway install
```

Expected: `node_modules/` created, `yarn.lock` committed; ~50 packages installed (Octokit's dep tree).

- [ ] **Step 8: Lint**

```bash
yarn --cwd packages/functions/github-gateway lint
```

Expected: no errors. If lint complains, fix the source.

---

### Task 5: Add the Makefile orchestrator + root backend scripts

**Files:**
- Create: `packages/functions/Makefile`
- Modify: `package.json` (root) — add `backend:build` and `backend:deploy`

- [ ] **Step 1: Create `packages/functions/Makefile`**

```makefile
# Orchestrates esbuild bundling + ZIP packaging for every Lambda function
# in this monorepo. Each subdirectory that contains a package.json is
# treated as a function:
#
#   1. yarn install --frozen-lockfile  (gets esbuild + deps)
#   2. yarn build                       (esbuild → dist/index.mjs)
#   3. zip dist/<name>.zip with index.mjs at the ZIP root
#
# Lambda's runtime then sees a single index.mjs file and the handler
# resolves as `index.handler`.

FUNCTIONS := $(notdir $(patsubst %/package.json,%,$(wildcard */package.json)))

.PHONY: build clean

build:
	@set -e; for fn in $(FUNCTIONS); do \
		echo "→ Building $$fn"; \
		( cd $$fn && yarn install --frozen-lockfile >/dev/null && yarn build >/dev/null ); \
		( cd $$fn/dist && rm -f $$fn.zip && zip -q $$fn.zip index.mjs ); \
		echo "✓ packages/functions/$$fn/dist/$$fn.zip ($$(du -h $$fn/dist/$$fn.zip | cut -f1))"; \
	done

clean:
	@rm -rf */dist
	@echo "✓ cleaned"
```

The ZIP contains just one file: `dist/index.mjs` (the esbuild bundle) at
the ZIP root. Lambda's handler is `index.handler` — the runtime
auto-detects ESM via the `.mjs` extension.

- [ ] **Step 2: Add root scripts to `package.json`**

Edit `/Users/jrsue/dev/repos/brigitte-leroux-website/package.json`. Add two scripts to the `"scripts"` block. The final block should read:

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
    "backend:deploy":    "make -C packages/functions build && yarn infra:apply",
    "infra:plan":        "terraform -chdir=packages/infrastructure plan",
    "infra:apply":       "terraform -chdir=packages/infrastructure apply -auto-approve"
  }
}
```

- [ ] **Step 3: Test the build**

```bash
yarn backend:build
```

Expected:
```
→ Building github-gateway
✓ packages/functions/github-gateway/dist/github-gateway.zip (3M)
```

(Size varies; ~3-5 MB for Octokit + AWS SDK is normal.)

Verify: `ls -lh packages/functions/github-gateway/dist/`.

---

### Task 6: Wire up the Lambda + APIGW trigger in Terraform

**Files:**
- Create: `packages/infrastructure/functions.tf`

- [ ] **Step 1: Create `packages/infrastructure/functions.tf`**

```hcl
# ---------------------------------------------------------------------------
# CMS Lambdas + their API Gateway triggers.
# Uses Maev4l/terraform-modules for both the Lambda function and the
# HTTP API + JWT authorizer + integrations + routes (bundled).
# ---------------------------------------------------------------------------

locals {
  githubGatewayZip    = "../functions/github-gateway/dist/github-gateway.zip"
  githubGatewayBundle = "../functions/github-gateway/dist/index.mjs"
}

# The github-gateway Lambda. Proxies Cognito-authenticated requests from
# Sveltia to api.github.com, enforcing path allowlist and commit-author
# rewrite. esbuild-bundled with @aws-sdk/* externalized (runtime-provided).
module "github_gateway" {
  source = "github.com/Maev4l/terraform-modules//modules/lambda-function?ref=v1.7.1"

  function_name = "brigitte-le-roux-website-github-gateway"
  architecture  = "arm64"
  memory_size   = 256
  timeout       = 30

  additional_policy_arns = [aws_iam_policy.github_gateway.arn]

  # `hash` is fed to source_code_hash; we hash the BUNDLED OUTPUT (the
  # esbuild-produced index.mjs) rather than the ZIP, because ZIP packaging
  # is non-deterministic (mtimes, file ordering) and would trigger spurious
  # Lambda updates on every apply.
  zip = {
    filename = local.githubGatewayZip
    runtime  = "nodejs22.x"
    handler  = "index.handler"
    hash     = filebase64sha256(local.githubGatewayBundle)
  }

  environment_variables = {
    ALLOWED_REPO             = "Maev4l/brigitte-le-roux-website"
    GITHUB_APP_SECRETS_PARAM = "brigitte-le-roux-website.github-app-secrets"
  }
}

# IAM policy: read the single GitHub App secrets JSON from SSM
# (SecureString), decrypt via the default AWS-managed KMS key. Logs perms
# are added by the lambda-function module.
data "aws_iam_policy_document" "github_gateway" {
  statement {
    effect  = "Allow"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/brigitte-le-roux-website.github-app-secrets",
    ]
  }
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alias/aws/ssm"]
  }
}

resource "aws_iam_policy" "github_gateway" {
  name        = "brigitte-le-roux-website-github-gateway"
  description = "github-gateway Lambda: read GitHub App credentials JSON from SSM SecureString"
  policy      = data.aws_iam_policy_document.github_gateway.json
}

# HTTP API + JWT authorizer + integration + route — all bundled by the
# module. A future Plan 5 media-uploader Lambda will be added as another
# entry in the `integrations` map (single module instance, shared HTTP API).
module "github_gateway_trigger" {
  source = "github.com/Maev4l/terraform-modules//modules/lambda-trigger-apigw?ref=v1.7.1"

  api_name = "brigitte-le-roux-website-cms"

  # disable_execute_api_endpoint defaults to true (forces traffic through a
  # custom domain). We don't have a custom domain on the API Gateway in
  # Plan 4 — the unified cms.brigitte-le-roux.com CloudFront distribution
  # comes later — so allow the execute-api URL for now to enable smoke
  # testing.
  disable_execute_api_endpoint = false

  cors = {
    allow_origins     = ["https://cms.brigitte-le-roux.com"]
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"]
    allow_headers     = ["authorization", "content-type"]
    expose_headers    = ["etag"]
    max_age           = 3600
    allow_credentials = false
  }

  authorizer = {
    name     = "cognito-jwt"
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.cms.id}"
    audience = [aws_cognito_user_pool_client.cms.id]
  }

  integrations = {
    "github-gateway" = {
      function_name = module.github_gateway.function_name
      function_arn  = module.github_gateway.function_arn
      invoke_arn    = module.github_gateway.invoke_arn
      routes = [
        "ANY /api/git/{proxy+}",
      ]
    }
  }
}

output "cms_api_endpoint" {
  value       = module.github_gateway_trigger.api_endpoint
  description = "API Gateway endpoint. Routes are reachable at <endpoint>/api/git/* (and /api/media/* once Plan 5 lands)."
}
```

Module v1.7.1 interface confirmed during execution:
- `lambda-function`: inputs `function_name`, `architecture`, `memory_size`,
  `timeout`, `additional_policy_arns`, `zip = { filename, runtime, handler, hash }`,
  `environment_variables`. Outputs: `function_name`, `function_arn`,
  `invoke_arn`, `role_name`, `role_arn`, `log_group_name`.
- `lambda-trigger-apigw`: inputs `api_name`, `integrations` (map of objects),
  `cors` (null/true/false/object), `authorizer` (object), `stage_name`,
  `custom_domain`, `disable_execute_api_endpoint`. Outputs: `api_id`,
  `api_endpoint`, `execution_arn`, `stage_id`, `authorizer_id`,
  `integration_ids`. **Important defaults**: `disable_execute_api_endpoint = true`
  by default — must set to `false` if you want the default execute-api
  URL reachable.

No Terraform variables needed for the GitHub App credentials — the App ID,
Installation ID, and PEM are all in the single SSM SecureString that the
Lambda reads at cold start (see Task 3). No `terraform.tfvars` to create.

- [ ] **Step 2: Format + validate**

```bash
terraform -chdir=packages/infrastructure init   # downloads the modules first time
terraform -chdir=packages/infrastructure fmt
terraform -chdir=packages/infrastructure validate
```

Expected: validate succeeds.

---

### Task 7: Terraform plan + apply

- [ ] **Step 1: Plan**

```bash
yarn infra:plan 2>&1 | tail -40
```

Expected: adds the Lambda function + role + log group + IAM policy + HTTP API + JWT authorizer + integration + route + Lambda permission for APIGW invoke. Typically ~10 resources.

If "1 to destroy" appears, it's likely a tainted resource from a prior failed apply — inspect before continuing.

- [ ] **Step 2: Apply**

```bash
yarn backend:deploy
```

(`backend:deploy` chains `make -C packages/functions build && yarn infra:apply`.)

Expected: succeeds. Outputs print `cms_api_endpoint`.

- [ ] **Step 3: Record the API endpoint**

```bash
terraform -chdir=packages/infrastructure output -raw cms_api_endpoint
```

Save this value — used in Tasks 8 + 9.

---

### Task 8: Smoke-test the Lambda via API Gateway with a Cognito token

End-to-end test: get a Cognito access token via SRP, call the github-gateway endpoint with it, see GitHub's response.

- [ ] **Step 1: Get a Cognito id_token for the test user**

Cognito's SRP auth flow is implemented by `amazon-cognito-identity-js`, but for a CLI smoke test we can use `aws cognito-idp admin-initiate-auth` with the `ADMIN_NO_SRP_AUTH` or `USER_PASSWORD_AUTH` flow. The latter requires the App Client to have `ALLOW_USER_PASSWORD_AUTH` enabled.

⚠️ This flow is not enabled by default in Plan 3's App Client (we have `ALLOW_USER_SRP_AUTH` only). Temporarily enable for testing:

```bash
APP_CLIENT_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_app_client_id)
USER_POOL_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id)

# Append ALLOW_USER_PASSWORD_AUTH to the explicit auth flows (for testing only).
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH \
  --output json | head -5
```

Then authenticate:

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --client-id "$APP_CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$TEST_USER_EMAIL",PASSWORD="$TEST_USER_PASSWORD" \
  --query 'AuthenticationResult.IdToken' \
  --output text)

echo "Got token ($(echo -n "$TOKEN" | wc -c) chars)"
```

Expected: a JWT (1000+ chars).

After testing (Task 8 Step 4), restore the original auth-flow list:
```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH
```

- [ ] **Step 2: Test the path allowlist rejects out-of-bounds writes**

Try to write to a path OUTSIDE `packages/website/content/`. Expected: 403.

```bash
API=$(terraform -chdir=packages/infrastructure output -raw cms_api_endpoint)

curl -sS -X PUT "${API}/api/git/repos/Maev4l/brigitte-le-roux-website/contents/packages/website/src/EVIL.txt" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"message":"should be rejected","content":"YmxhaA=="}' \
  -w "\nHTTP %{http_code}\n"
```

Expected: response body `{"error":"Path not in allowlist","path":"packages/website/src/EVIL.txt"}` and `HTTP 403`.

- [ ] **Step 3: Test a happy-path write to an allowed path**

Pick a test file path under the allowlist. Use a new file to avoid clobbering anything.

```bash
TEST_PATH="packages/website/content/pages/cv/__plan4_smoke.md"
TEST_CONTENT=$(printf '# Smoke test from Plan 4\nDelete me.\n' | base64)

curl -sS -X PUT "${API}/api/git/repos/Maev4l/brigitte-le-roux-website/contents/${TEST_PATH}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"message\":\"smoke: plan-4 github-gateway test\",\"content\":\"${TEST_CONTENT}\"}" \
  | tee /tmp/gateway-response.json | head -30
```

Expected: response shows a commit object (status 201). The commit lands on `main` of `Maev4l/brigitte-le-roux-website`.

Verify on GitHub: `gh api repos/Maev4l/brigitte-le-roux-website/commits/main --jq '.commit.author' && gh api repos/Maev4l/brigitte-le-roux-website/commits/main --jq '.commit.message'`

Expected:
- `commit.author.email` equals `$TEST_USER_EMAIL` (the email-claim rewrite worked)
- `commit.message == "smoke: plan-4 github-gateway test"`

- [ ] **Step 4: Clean up: delete the smoke-test file via the gateway**

Get the file SHA + delete:

```bash
SHA=$(curl -sS "${API}/api/git/repos/Maev4l/brigitte-le-roux-website/contents/${TEST_PATH}" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.sha')

curl -sS -X DELETE "${API}/api/git/repos/Maev4l/brigitte-le-roux-website/contents/${TEST_PATH}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"message\":\"smoke: plan-4 cleanup\",\"sha\":\"${SHA}\"}" \
  -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 200, smoke-test file removed from the repo. Verify with `gh api repos/Maev4l/brigitte-le-roux-website/contents/${TEST_PATH} -i | head -1` — expects `HTTP/2.0 404`.

- [ ] **Step 5: Restore the App Client's auth-flow list**

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --output json | rtk proxy grep ExplicitAuthFlows
```

Expected: prints `"ExplicitAuthFlows": ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]`.

- [ ] **Step 6: Verify the CI/CD pipeline picked up the smoke-test commit**

Check the GitHub Actions deploy-website workflow ran (or didn't, depending on path):

```bash
gh run list --workflow=deploy-website.yml --limit 3
```

Expected: a run was triggered for the smoke-test commit because the path filter matches `packages/website/**`. The cleanup commit also triggers another. The site rebuilds — verify `https://brigitte-le-roux.com/cv/` still 200s.

(If you want to avoid the noise from smoke-test commits in workflow history later, you can re-run smoke tests against a path that DOESN'T match the workflow's path filter — but for now this is fine.)

---

### Task 9: Stage, review, commit

Multiple commits this time — splits the Lambda code from the Terraform.

- [ ] **Step 1: Commit the Lambda code + Makefile + root scripts**

```bash
git add packages/functions/github-gateway/ packages/functions/Makefile package.json

git status --short
```

Expected: lists the new files under `packages/functions/github-gateway/`, the new `Makefile`, and modified root `package.json`. NOT the `dist/` folder (gitignored).

⚠️ **Add `packages/functions/*/dist/` to `.gitignore`** before staging if it's not already covered. Run:
```bash
rtk proxy grep "packages/functions" .gitignore
```

If no match, append to `.gitignore`:
```
# Lambda ZIP artefacts
packages/functions/*/dist/
packages/functions/*/node_modules/
```

(`node_modules/` is already covered, but explicit reinforcement doesn't hurt.)

Commit:
```bash
git commit -m "$(cat <<'EOF'
feat(functions): add github-gateway Lambda

Cognito-authenticated proxy from Sveltia to api.github.com via a GitHub
App. Plain JS ESM, Node 22, ZIP-packaged on arm64.

- packages/functions/github-gateway/index.mjs
  Handler: JWT claim check → path allowlist → commit-author rewrite →
  Octokit forward.

- packages/functions/github-gateway/lib/
  Helpers split for testability: allowlist.mjs, commit-author.mjs,
  octokit.mjs (single-JSON SSM SecureString fetch + Octokit App auth,
  module-load cache).

- packages/functions/github-gateway/package.json
  Strict-pinned deps: @octokit/rest, @octokit/auth-app, @aws-sdk/client-ssm.
  Build script uses esbuild to bundle index.mjs → dist/index.mjs with
  @aws-sdk/* externalized (Lambda runtime-provided).

- packages/functions/Makefile
  Orchestrator: `make build` runs `yarn build` (esbuild) for every
  function and zips the bundled dist/index.mjs into dist/<name>.zip.
  Used by root `yarn backend:build` and `yarn backend:deploy`.

- package.json (root)
  Add backend:build + backend:deploy scripts (per the alexandria-style
  namespaced layout: frontend:* / backend:* / infra:*).

- .gitignore (if updated)
  Ignore packages/functions/*/dist/ ZIP artefacts.
EOF
)"
```

- [ ] **Step 2: Commit the Terraform changes**

```bash
git add packages/infrastructure/functions.tf packages/infrastructure/variables.tf

git status --short
```

Expected: lists `functions.tf` (new) and `variables.tf` (modified — only
to add the explanatory comment about credentials living in SSM, not as
Terraform variables).

Commit:
```bash
git commit -m "$(cat <<'EOF'
infra(cms): wire github-gateway Lambda + API Gateway via terraform-modules

Uses Maev4l/terraform-modules//modules/lambda-function (v1.7.1) for the
Lambda resource and //modules/lambda-trigger-apigw (v1.7.1) for the HTTP
API + JWT authorizer + integration + route. JWT issuer is the Cognito
User Pool from Plan 3; audience is its App Client.

The HTTP API exposes the Lambda at /api/git/{proxy+} (any verb). API
Gateway's JWT authorizer validates the Cognito Bearer token before
the Lambda is invoked.

GitHub App credentials (app_id, installation_id, private_key) live in
a single SSM SecureString parameter as JSON:
  brigitte-le-roux-website.github-app-secrets
The Lambda reads + parses it at cold start. No Terraform variables for
GitHub App credentials; no terraform.tfvars.

source_code_hash is computed over the BUNDLED dist/index.mjs (not the
ZIP, which is non-deterministic), so re-applies don't trigger spurious
Lambda updates.
EOF
)"
```

- [ ] **Step 3: Confirm history**

Run: `git log --oneline -5`

Expected: two new commits on top, plus the prior CMS commits.

---

### Task 10: Push to `main`

- [ ] **Step 1: Push**

```bash
git push origin main 2>&1 | tail -3
```

Expected: succeeds.

- [ ] **Step 2: Confirm no workflow run was triggered**

The path filter is `packages/website/**`. Neither Lambda code (`packages/functions/`) nor Terraform (`packages/infrastructure/`) match.

```bash
gh run list --workflow=deploy-website.yml --limit 1 --json status,headSha
```

Expected: the most recent run is from the smoke-test (Task 8), NOT from the push of Plan 4's commits.

---

## Self-Review

**Spec coverage** (against spec §3 github-gateway Lambda + §4 API Gateway):

| Spec requirement | Plan task |
| --- | --- |
| `github-gateway` Lambda (Node 22 ESM, ZIP, arm64) | Tasks 4 + 6 |
| Reads GitHub App credentials from a single SSM SecureString JSON at cold start, caches | Task 4 (lib/octokit.mjs) + Task 3 (SSM upload) |
| Octokit + `createAppAuth` for installation tokens | Task 4 (lib/octokit.mjs) |
| Path allowlist enforcement (only `packages/website/content/`) | Task 4 (lib/allowlist.mjs) |
| Commit-author rewrite from JWT email claim | Task 4 (lib/commit-author.mjs) |
| Repo lock (rejects requests for other repos) | Task 4 (index.mjs `isAllowedRepo`) |
| HTTP API + JWT authorizer via `lambda-trigger-apigw` module | Task 6 |
| Route `/api/git/{proxy+}` | Task 6 |
| CORS for `cms.brigitte-le-roux.com` | Task 6 |
| SSM SecureString param `brigitte-le-roux-website.github-app-secrets` (single JSON) | Task 3 |
| GitHub App creation + install + private key | Task 2 |
| End-to-end smoke test (real commit via gateway) | Task 8 |

**Out of scope** (handled in later plans):
- `media-uploader` Lambda + its API Gateway integration (Plan 5)
- Sveltia config + custom plugin JS files (Plan 6)
- CMS CloudFront distribution at `cms.brigitte-le-roux.com` (Plan 7 or its own micro-plan)
- Custom domain on the API Gateway (deferred — `cms.brigitte-le-roux.com/api/*` via CloudFront origin proxying)
- MFA enablement on Cognito (deferred)
- CODEOWNERS file for `.github/`, `packages/functions/`, etc. (small follow-up)
- Cleanup of the deprecated SSM parameter `brigitte-le-roux-website.github-app-private-key` (admin-only delete; placeholder value already overwrites the PEM)

**Notes on the `lambda-trigger-apigw` module interface** (confirmed during execution):
- `cors` accepts either `null/false/true` or an object with `allow_origins`,
  `allow_methods`, `allow_headers`, `expose_headers`, `max_age`,
  `allow_credentials` (NOT separate `cors_allow_*` variables).
- Outputs include `api_id`, `api_endpoint`, `execution_arn`,
  `stage_id`, `authorizer_id`, `integration_ids`.
- **`disable_execute_api_endpoint` defaults to `true`** — must set to
  `false` until a custom domain is wired up.
- Adding Plan 5's media-uploader is a single new entry in the same
  `integrations` map (one shared HTTP API).

**Deviations from the original spec** (rolled back into the spec
after execution):
- The spec described an `aws_apigatewayv2_*` standalone Terraform
  configuration in §4. This plan uses the `lambda-trigger-apigw` module
  instead, per the instruction to use Maev4l/terraform-modules for
  Lambdas + their triggers. The module bundles HTTP API + authorizer
  + integrations + routes; net effect is the same.
- API Gateway custom domain (`cms-api.brigitte-le-roux.com` per the
  original spec) is dropped entirely — replaced by the unified
  `cms.brigitte-le-roux.com/api/*` routed through CloudFront in a
  later plan.
- **esbuild bundling** added during execution: source bundled to
  `dist/index.mjs` (~180 KB), wrapped in a 36 KB ZIP, with `@aws-sdk/*`
  externalized (runtime-provided). Replaces the initial "zip the whole
  function directory" approach (~5 MB).
- **Single SSM SecureString containing JSON** for App ID + Installation
  ID + private key, instead of separate Terraform vars + a PEM-only
  SSM SecureString. No `terraform.tfvars`; no GitHub App credentials
  in Terraform state.
- **`source_code_hash` hashes the bundled file**, not the ZIP — ZIPs
  are non-deterministic and would force spurious Lambda updates.
