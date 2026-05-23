# media-manager Refactor to LWA + S3-credentials Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the `media-manager` Lambda away from presigned URLs (which Sveltia can't consume — see spec §4 design pivot note) toward a credentials-issuing endpoint backed by a tightly-scoped IAM user. Repackage the Lambda using AWS Lambda Web Adapter (LWA) **with the AWS-published Lambda Layer + ZIP** so the same Hono server runs locally (`yarn dev`) and in Lambda — no Docker, no ECR, no two-phase deploy.

**Architecture:**

```
Sveltia (browser, future Plan 8)
   │ Authorization: Bearer <Cognito id_token>
   │ GET /api/media/s3-credentials
   ▼
CloudFront cms.brigitte-le-roux.com (Plan 6)
   │
   ▼
API Gateway HTTP API + JWT authorizer (Plan 4/5)
   │ Cognito User Pool validates id_token before invoking Lambda
   ▼
media-manager Lambda (nodejs22.x runtime, arm64 / Graviton, ZIP)
   ├── Lambda Layer: AWS Lambda Web Adapter (LambdaAdapterLayerArm64:27)
   │   AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap → LWA starts on cold init
   │   LWA listens for Lambda invocations, forwards to localhost:8080
   ├── Handler: run.sh → executes `node index.mjs`
   ▼
   Hono server on :8080 (the actual handler code)
   ├── Module load:
   │   - reads brigitte-le-roux-website.sveltia-media-manager-credentials from SSM
   │   - parses { access_key_id, secret_access_key }
   │   - caches in module scope (no per-request SSM call)
   └── GET /api/media/s3-credentials
       - returns cached credentials as JSON
       - logs the issuance (no credential values in logs)
```

**Tech Stack:**

- Node.js 22 ESM (plain JS, fat-arrow, no TypeScript, strict-pinned deps)
- AWS Lambda Web Adapter `:27` from AWS-published public Lambda Layer
- HTTP framework: [Hono](https://hono.dev) (~10 KB, edge-first) + `@hono/node-server`
- Deps: `@aws-sdk/client-ssm` (provided by Node 22 runtime — externalized at build)
- Packaging: esbuild bundle → ZIP (same path as github-gateway). NO Docker, NO ECR.
- Terraform via `Maev4l/terraform-modules//modules/lambda-function` (v1.7.1), same `zip = {...}` variant Plan 5 used, with a new `layers = [...]` input attaching the AWS LWA layer

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §4 (rewritten in commit `de914d7` for this refactor).

---

## Preconditions

- On `main`, working tree clean (HEAD includes commit `bd0f420` — the Plan 7 doc).
- Dev role can create the IAM user + inline policy via Terraform. If denied, Task 2 has a manual-console fallback.
- Dev role has `aws iam create-access-key` permission for the new user (typically granted via `iam:CreateAccessKey` on the user's own ARN).
- Plan 5's media-manager Lambda is currently live (ZIP packaging, `POST /api/media/upload-url`). This plan replaces its source + route + IAM in a single apply; expect ~10s of route 503 during the apply.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/functions/media-manager/index.mjs` | **rewrite** | Hono server: SSM read at cold start, single `GET /api/media/s3-credentials` route |
| `packages/functions/media-manager/run.sh` | **NEW** | 3-line `#!/bin/bash` script executing `node index.mjs`; Lambda's handler value |
| `packages/functions/media-manager/lib/presigner.mjs` | **delete** | Obsolete (presigned-URL design dropped) |
| `packages/functions/media-manager/lib/invalidator.mjs` | **delete** | Obsolete |
| `packages/functions/media-manager/lib/validation.mjs` | **delete** | Obsolete (no upload body to validate anymore) |
| `packages/functions/media-manager/package.json` | modify | Drop S3+presigner+CloudFront deps; add hono + @hono/node-server; add `dev` script for local server |
| `packages/functions/media-manager/eslint.config.js` | unchanged | (kept) |
| `packages/functions/Makefile` | modify | Append `run.sh` to the ZIP when it exists alongside a function's source (no-op for github-gateway, which has no run.sh) |
| `packages/infrastructure/iam.tf` | modify | Add `aws_iam_user` + `aws_iam_user_policy` for the Sveltia upload user (scoped to PutObject + ListBucket on the three prefixes) |
| `packages/infrastructure/functions.tf` | modify | media-manager Lambda: drop S3+CF IAM perms; add SSM read + kms:Decrypt; add `layers = [LWA arm64 layer]`; replace env vars with `AWS_LAMBDA_EXEC_WRAPPER` + `MEDIA_MANAGER_CREDENTIALS_PARAM` + `PORT`; rename handler `index.handler` → `run.sh`; rename route `POST /api/media/upload-url` → `GET /api/media/s3-credentials` |

`.gitignore` already covers `packages/functions/*/dist/` from Plan 5 — no change.

## Approach notes

- **No Docker, no ECR.** Plan 7's first draft proposed a container image; this is the ZIP+Layer rewrite per user direction (2026-05-23). The ZIP approach matches github-gateway's packaging and tooling exactly.
- **One apply suffices.** ZIP packaging means no two-phase bootstrap. The Lambda update is an in-place code swap, not a function recreation.
- **`run.sh` must be executable inside the ZIP.** The Makefile uses `zip` which preserves the executable bit if set on the source file. Task 3 ensures `chmod +x` is run on the checked-in file (git tracks the +x permission).
- **No per-user logging attribution.** LWA doesn't surface the API Gateway request context (incl. JWT claims) to the HTTP server by default. We log just the issuance event, not the email. API Gateway's CloudWatch logs hold the per-request audit trail if needed later.
- **Long-lived IAM credentials** are pragmatic because Sveltia's S3 SigV4 doesn't support session tokens. Mitigations + upstream-PR direction are documented in spec §4.

---

### Task 1: Verify preconditions

- [ ] **Step 1: Branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty. HEAD should be `bd0f420` or later.

- [ ] **Step 2: Confirm Plan 4/5/6 outputs reachable + dev role can manage IAM users**

```bash
terraform -chdir=packages/infrastructure output -raw cms_api_endpoint
terraform -chdir=packages/infrastructure output -raw cognito_app_client_id
aws iam list-users --max-items 1 2>&1 | head -3
```

Expected:
- `cms_api_endpoint` prints `https://3axzobd6f1.execute-api.eu-central-1.amazonaws.com`
- `cognito_app_client_id` prints a non-empty value
- `list-users` succeeds (any output). If `AccessDenied`, Task 2 has the console fallback.

- [ ] **Step 3: `yarn infra:plan` is clean**

⚠️ Use `timeout: 600000` on the Bash call (per project's long-bash-timeout policy for terraform commands).

```bash
yarn infra:plan 2>&1 | rtk proxy grep -E 'No changes\.|Plan:' | head -3
```

Expected: contains "No changes." (zero drift from Plan 6's apply).

---

### Task 2: Create the IAM user + access key + SSM SecureString

The IAM user is `brigitte-le-roux-website-sveltia-media-manager`. **Programmatic access only — no console login profile.** Its access key + secret go into SSM SecureString `brigitte-le-roux-website.sveltia-media-manager-credentials` as JSON: `{"access_key_id": "...", "secret_access_key": "..."}`.

**Split of responsibilities:**

| Resource | Tool | Why |
|---|---|---|
| IAM user + inline policy | Terraform | Drift detection, idempotent |
| Access key + secret | AWS CLI | Secret never lands in Terraform state |
| SSM SecureString | AWS CLI | Same — value never lands in Terraform state |

- [ ] **Step 1: Add the IAM user + inline policy to Terraform**

Append to `packages/infrastructure/iam.tf` (after the existing `gha-website-deploy` blocks):

```hcl
# Dedicated IAM user that Sveltia's built-in S3 media library uses to
# upload editor-supplied PDFs / images / data files into the website
# bucket. Programmatic access only — no console login profile.
#
# The access key + secret are NOT managed by Terraform (would expose
# them in state). They are created via `aws iam create-access-key`
# after this resource is applied, and stored in SSM SecureString
# `brigitte-le-roux-website.sveltia-media-manager-credentials` —
# consumed by the media-manager Lambda at cold start.
resource "aws_iam_user" "sveltia_media_manager" {
  name = "brigitte-le-roux-website-sveltia-media-manager"
  tags = {
    purpose = "sveltia-cms-media-uploads"
  }
}

data "aws_iam_policy_document" "sveltia_media_manager" {
  # Sveltia's S3 library calls ListObjectsV2 to enumerate the prefix
  # when the editor opens the media browser. Limit it to our three
  # media prefixes via the s3:prefix condition.
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["pdfs/*", "img/*", "data/*"]
    }
  }
  statement {
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.site.arn}/pdfs/*",
      "${aws_s3_bucket.site.arn}/img/*",
      "${aws_s3_bucket.site.arn}/data/*",
    ]
  }
}

resource "aws_iam_user_policy" "sveltia_media_manager" {
  name   = "sveltia-media-manager-policy"
  user   = aws_iam_user.sveltia_media_manager.name
  policy = data.aws_iam_policy_document.sveltia_media_manager.json
}
```

- [ ] **Step 2: Format + plan + apply (just the IAM user — focused apply)**

```bash
terraform -chdir=packages/infrastructure fmt
yarn infra:plan 2>&1 | tail -15
```

Expected: ~2 resources to add (`aws_iam_user.sveltia_media_manager`, `aws_iam_user_policy.sveltia_media_manager`).

```bash
yarn infra:apply 2>&1 | tail -5
```

⚠️ Use `timeout: 600000`. Expected: 2 resources added.

If the apply fails with `AccessDenied` on `iam:CreateUser`, abort the Terraform path: `git restore packages/infrastructure/iam.tf` to remove the block, then use the manual console fallback below.

**Manual console fallback (only if Terraform can't create the user):**

1. AWS Console → IAM → Users → Create user
2. Name: `brigitte-le-roux-website-sveltia-media-manager`
3. **DO NOT** check "Provide user access to AWS Management Console"
4. Permissions: attach inline policy with this JSON (equivalent to the Terraform policy above):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::brigitte-le-roux-website",
      "Condition": { "StringLike": { "s3:prefix": ["pdfs/*", "img/*", "data/*"] } }
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::brigitte-le-roux-website/pdfs/*",
        "arn:aws:s3:::brigitte-le-roux-website/img/*",
        "arn:aws:s3:::brigitte-le-roux-website/data/*"
      ]
    }
  ]
}
```

5. After creating: do NOT generate the access key here — Step 3 below uses `aws iam create-access-key` so the secret is piped directly to SSM without ever landing on disk.

- [ ] **Step 3: Generate the access key + write to SSM in one pipe**

```bash
aws iam create-access-key --user-name brigitte-le-roux-website-sveltia-media-manager \
  --query 'AccessKey.{access_key_id:AccessKeyId,secret_access_key:SecretAccessKey}' \
  --output json | \
  aws ssm put-parameter \
    --name brigitte-le-roux-website.sveltia-media-manager-credentials \
    --type SecureString \
    --description "Access key + secret for the brigitte-le-roux-website-sveltia-media-manager IAM user. Consumed by the media-manager Lambda at cold start. JSON: { access_key_id, secret_access_key }." \
    --value file:///dev/stdin \
    --output json | jq '{Version, Tier}'
```

Expected: prints `{ "Version": 1, "Tier": "Standard" }`. The pipeline:

1. `aws iam create-access-key` returns the access key + secret as JSON
2. The `--query` rewrites it to use snake_case keys matching our convention
3. The JSON is piped directly into `aws ssm put-parameter` via `file:///dev/stdin`
4. SSM stores it as a SecureString encrypted with `alias/aws/ssm`

**The secret never touches the disk or shell history.** It exists only in stdin between the two CLI invocations.

- [ ] **Step 4: Verify the parameter exists (without printing the value)**

```bash
aws ssm get-parameter \
  --name brigitte-le-roux-website.sveltia-media-manager-credentials \
  --with-decryption \
  --query 'Parameter.{Name:Name,Type:Type,Length:length(Value)}'
```

Expected: shows the parameter with a Length around 150-200.

---

### Task 3: Refactor media-manager source code

**Files:**
- Rewrite: `packages/functions/media-manager/index.mjs`
- Create: `packages/functions/media-manager/run.sh`
- Delete: `packages/functions/media-manager/lib/presigner.mjs`
- Delete: `packages/functions/media-manager/lib/invalidator.mjs`
- Delete: `packages/functions/media-manager/lib/validation.mjs`
- Modify: `packages/functions/media-manager/package.json`

- [ ] **Step 1: Replace `index.mjs` with a Hono server**

Overwrite `packages/functions/media-manager/index.mjs`:

```js
// Hono server bridging API Gateway events (via AWS Lambda Web Adapter)
// to a standard HTTP handler on :8080. Cold start reads the IAM user's
// access key + secret from SSM SecureString, caches them in module
// scope, and serves them via GET /api/media/s3-credentials. The route
// is gated by API Gateway's JWT authorizer (Cognito) before requests
// reach this server — any authenticated CMS user can fetch the creds.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

let cachedCreds = null;

const loadCreds = async () => {
  if (cachedCreds) return cachedCreds;
  const result = await ssm.send(
    new GetParameterCommand({
      Name: process.env.MEDIA_MANAGER_CREDENTIALS_PARAM,
      WithDecryption: true,
    }),
  );
  cachedCreds = JSON.parse(result.Parameter.Value);
  return cachedCreds;
};

const app = new Hono();

app.get('/api/media/s3-credentials', async (c) => {
  try {
    const creds = await loadCreds();
    console.log(JSON.stringify({ event: 's3-credentials-issued' }));
    return c.json(creds);
  } catch (err) {
    console.error('media-manager error', { message: err.message });
    return c.json({ error: 'Failed to load credentials' }, 502);
  }
});

const port = Number.parseInt(process.env.PORT || '8080', 10);
serve({ fetch: app.fetch, port });
console.log(`media-manager listening on :${port}`);
```

- [ ] **Step 2: Create `run.sh` (Lambda handler entrypoint)**

Write `packages/functions/media-manager/run.sh`:

```bash
#!/bin/bash
node index.mjs
```

Make it executable so the ZIP preserves the +x bit:

```bash
chmod +x packages/functions/media-manager/run.sh
```

The Lambda configuration uses `run.sh` as its handler value. When AWS_LAMBDA_EXEC_WRAPPER points at the LWA bootstrap, the bootstrap starts the LWA adapter in the background and then exec's the handler — `run.sh` — which kicks off the Hono server. LWA forwards API Gateway invocations to `localhost:8080`.

- [ ] **Step 3: Delete the obsolete `lib/` files**

```bash
rm -f packages/functions/media-manager/lib/presigner.mjs \
      packages/functions/media-manager/lib/invalidator.mjs \
      packages/functions/media-manager/lib/validation.mjs
rmdir packages/functions/media-manager/lib 2>/dev/null || true
```

Expected: the three files are gone; the `lib/` directory is empty and removed.

- [ ] **Step 4: Update `package.json`**

Overwrite `packages/functions/media-manager/package.json`:

```json
{
  "name": "media-manager",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "description": "Issues Sveltia's S3 upload credentials over an authenticated endpoint. Lambda Web Adapter + Hono.",
  "main": "index.mjs",
  "scripts": {
    "lint": "eslint .",
    "dev": "node index.mjs",
    "build": "esbuild index.mjs --bundle --platform=node --target=node22 --format=esm --outfile=dist/index.mjs --external:@aws-sdk/* --banner:js=\"import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);\""
  },
  "dependencies": {
    "@aws-sdk/client-ssm": "3.687.0",
    "@hono/node-server": "1.13.7",
    "hono": "4.6.12"
  },
  "devDependencies": {
    "@eslint/js": "9.15.0",
    "esbuild": "0.24.0",
    "eslint": "9.15.0"
  }
}
```

Bumped to `2.0.0` to signal the breaking refactor. Same esbuild bundle pattern as github-gateway. `yarn dev` runs the Hono server locally without LWA — useful for poking at the routes during development.

- [ ] **Step 5: Install + lint**

```bash
yarn --cwd packages/functions/media-manager install
yarn --cwd packages/functions/media-manager lint
```

Expected: install creates a fresh `yarn.lock` with the new deps; lint runs clean.

- [ ] **Step 6: Smoke-test locally (optional but recommended)**

```bash
export MEDIA_MANAGER_CREDENTIALS_PARAM="brigitte-le-roux-website.sveltia-media-manager-credentials"
export AWS_REGION="eu-central-1"
yarn --cwd packages/functions/media-manager dev &
sleep 2
curl -sS http://localhost:8080/api/media/s3-credentials | jq 'keys'
kill %1
unset MEDIA_MANAGER_CREDENTIALS_PARAM AWS_REGION
```

Expected: returns `["access_key_id", "secret_access_key"]`. The local Node process uses the shell's AWS credentials profile (which must have `ssm:GetParameter` on the SecureString) to fetch the creds — same code path the Lambda will exercise.

---

### Task 4: Update the Makefile to include `run.sh` in the ZIP

**Files:**
- Modify: `packages/functions/Makefile`

The existing Makefile zips just `dist/index.mjs` for each function. We extend it: if `<function>/run.sh` exists, append it to the ZIP. github-gateway has no `run.sh`, so its ZIP is unchanged.

- [ ] **Step 1: Replace `packages/functions/Makefile`**

Overwrite `packages/functions/Makefile`:

```makefile
# Orchestrates esbuild bundling + ZIP packaging for every Lambda
# function in this monorepo. Each subdirectory that contains a
# package.json is treated as a function:
#
#   1. yarn install --frozen-lockfile  (gets esbuild + deps)
#   2. yarn build                       (esbuild → dist/index.mjs)
#   3. zip dist/<name>.zip with index.mjs at the ZIP root
#   4. If <function>/run.sh exists (LWA-based handlers), append it to
#      the ZIP. Lambda's handler value becomes run.sh; LWA's exec
#      wrapper runs it on cold init.
#
# Lambda's runtime sees `index.mjs` (event-handler functions) OR
# `run.sh` + `index.mjs` (LWA-based functions), depending on which
# files the ZIP contains.

FUNCTIONS := $(notdir $(patsubst %/package.json,%,$(wildcard */package.json)))

.PHONY: build clean

build:
	@set -e; for fn in $(FUNCTIONS); do \
		echo "→ Building $$fn"; \
		( cd $$fn && yarn install --frozen-lockfile >/dev/null && yarn build >/dev/null ); \
		( cd $$fn/dist && rm -f $$fn.zip && zip -q $$fn.zip index.mjs ); \
		if [ -f $$fn/run.sh ]; then \
			( cd $$fn && zip -qj dist/$$fn.zip run.sh ); \
			echo "  (LWA handler — appended run.sh)"; \
		fi; \
		echo "✓ packages/functions/$$fn/dist/$$fn.zip ($$(du -h $$fn/dist/$$fn.zip | cut -f1))"; \
	done

clean:
	@rm -rf */dist
	@echo "✓ cleaned"
```

The `-j` flag on the second `zip` strips the path so `run.sh` lands at the ZIP root (where Lambda's handler resolution expects it).

- [ ] **Step 2: Test the build**

```bash
yarn backend:build
```

Expected output:

```
→ Building github-gateway
✓ packages/functions/github-gateway/dist/github-gateway.zip (36K)
→ Building media-manager
  (LWA handler — appended run.sh)
✓ packages/functions/media-manager/dist/media-manager.zip (...K)
```

The media-manager ZIP should be slightly larger than github-gateway because Hono + @hono/node-server bundle is a bit bigger than Octokit's bundled output. Typical size: ~80-120 KB.

- [ ] **Step 3: Verify the ZIP layout**

```bash
unzip -l packages/functions/media-manager/dist/media-manager.zip
```

Expected: two files at the ZIP root:

```
index.mjs
run.sh
```

`run.sh` must have its executable bit preserved — `unzip -Z` shows file modes.

---

### Task 5: Refactor `module.media_manager` in Terraform

**Files:**
- Modify: `packages/infrastructure/functions.tf` — the existing `module "media_manager"` block + its IAM + the integration on `module.cms_trigger`

- [ ] **Step 1: Replace the existing media_manager + IAM blocks**

Open `packages/infrastructure/functions.tf`. Locate the existing media-manager section (the `locals` block with `mediaManagerZip`/`mediaManagerBundle`, the `module "media_manager"` block, and the `aws_iam_policy_document.media_manager` / `aws_iam_policy.media_manager` blocks). Replace ALL of that with:

```hcl
# ---------------------------------------------------------------------------
# media-manager Lambda (refactored in Plan 7 — LWA + Hono + ZIP).
# Issues IAM credentials for Sveltia's built-in S3 media library via
# GET /api/media/s3-credentials. AWS Lambda Web Adapter bridges API
# Gateway events to a Hono HTTP server on localhost:8080 inside the
# Lambda's Node 22 runtime.
# ---------------------------------------------------------------------------

locals {
  mediaManagerZip    = "../functions/media-manager/dist/media-manager.zip"
  mediaManagerBundle = "../functions/media-manager/dist/index.mjs"

  # AWS-published public Lambda Layer. Pinned to :27 (current as of
  # 2026-05-23). Bump deliberately when AWS publishes a newer version.
  lwa_layer_arn = "arn:aws:lambda:${var.aws_region}:753240598075:layer:LambdaAdapterLayerArm64:27"
}

module "media_manager" {
  source = "github.com/Maev4l/terraform-modules//modules/lambda-function?ref=v1.7.1"

  function_name = "brigitte-le-roux-website-media-manager"
  architecture  = "arm64"
  memory_size   = 256
  timeout       = 10

  additional_policy_arns = [aws_iam_policy.media_manager.arn]

  # ZIP packaging — same as github-gateway. Handler is run.sh (a shell
  # script that exec's `node index.mjs`); LWA's exec wrapper picks it
  # up via AWS_LAMBDA_EXEC_WRAPPER. source_code_hash on the BUNDLED
  # output (not the ZIP) so a fresh build with identical source
  # doesn't trigger spurious updates.
  zip = {
    filename = local.mediaManagerZip
    runtime  = "nodejs22.x"
    handler  = "run.sh"
    hash     = filebase64sha256(local.mediaManagerBundle)
  }

  # Attach the AWS Lambda Web Adapter layer (arm64). LWA boots before
  # the user handler, listens for Lambda invocations, and proxies them
  # as HTTP to the Hono server on :8080.
  layers = [local.lwa_layer_arn]

  environment_variables = {
    # LWA bootstrap entry point — installed by the layer at /opt.
    AWS_LAMBDA_EXEC_WRAPPER          = "/opt/bootstrap"
    # The SSM SecureString containing { access_key_id, secret_access_key }
    MEDIA_MANAGER_CREDENTIALS_PARAM  = "brigitte-le-roux-website.sveltia-media-manager-credentials"
    # Hono binds to this port; LWA dials it on the same loopback.
    PORT                             = "8080"
  }
}

# IAM policy: read the SSM SecureString holding the IAM-user creds,
# decrypt via the default AWS-managed KMS key. No S3, no CloudFront —
# those concerns moved to the dedicated IAM user that Sveltia uses
# for browser-to-S3 uploads.
data "aws_iam_policy_document" "media_manager" {
  statement {
    effect  = "Allow"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/brigitte-le-roux-website.sveltia-media-manager-credentials",
    ]
  }
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alias/aws/ssm"]
  }
}

resource "aws_iam_policy" "media_manager" {
  name        = "brigitte-le-roux-website-media-manager"
  description = "media-manager Lambda: read sveltia-media-manager-credentials SSM SecureString"
  policy      = data.aws_iam_policy_document.media_manager.json
}
```

- [ ] **Step 2: Update the route in `module.cms_trigger`**

Still in `functions.tf`, locate the `integrations` map inside `module "cms_trigger"`. The current `media-manager` entry has `routes = ["POST /api/media/upload-url"]`. Replace it with:

```hcl
    "media-manager" = {
      function_name = module.media_manager.function_name
      function_arn  = module.media_manager.function_arn
      invoke_arn    = module.media_manager.invoke_arn
      routes = [
        "GET /api/media/s3-credentials",
      ]
    }
```

The route changes both HTTP method (POST → GET) and path (`/api/media/upload-url` → `/api/media/s3-credentials`).

- [ ] **Step 3: Format + validate**

```bash
terraform -chdir=packages/infrastructure fmt
terraform -chdir=packages/infrastructure validate
```

Expected: validate prints `Success! The configuration is valid.`

---

### Task 6: Terraform plan + apply

- [ ] **Step 1: Plan**

⚠️ Use `timeout: 600000`.

```bash
yarn infra:plan 2>&1 | tail -40
```

Expected:

- **In-place updates** on `module.media_manager.aws_lambda_function.this` (new handler, new layers, new env vars, new source_code_hash; ZIP-to-ZIP swaps don't force replacement)
- **In-place update** on `aws_iam_policy.media_manager` (different statements)
- **Route replacement** on `module.cms_trigger.aws_apigatewayv2_route.this["media-manager:POST /api/media/upload-url"]` → destroy + recreate as `"media-manager:GET /api/media/s3-credentials"` (route key is `ForceNew`)
- **Integration update** in place (method change)
- Possibly **Lambda permission re-create** depending on whether the route ARN changed

Summary line: typically ~1-2 adds + ~3-4 in-place updates + ~1-2 destroys. **No destruction of the Lambda function itself** (ZIP→ZIP is in-place), and no destruction of cms_trigger.

If the plan tries to destroy the Lambda function or anything outside the media-manager scope, STOP with BLOCKED.

- [ ] **Step 2: Apply**

```bash
yarn infra:apply 2>&1 | tail -10
```

⚠️ Use `timeout: 600000`. Expected: succeeds in <60 s.

- [ ] **Step 3: Confirm Lambda configuration**

```bash
aws lambda get-function-configuration --function-name brigitte-le-roux-website-media-manager \
  --query '{PackageType:PackageType,Runtime:Runtime,Handler:Handler,Layers:Layers[*].Arn,State:State}'
```

Expected:
- `PackageType: Zip`
- `Runtime: nodejs22.x`
- `Handler: run.sh`
- `Layers` contains the LambdaAdapterLayerArm64 ARN
- `State: Active`

---

### Task 7: Smoke test the new endpoint

Requires `$TEST_USER_EMAIL` + `$TEST_USER_PASSWORD` exported in the shell.

- [ ] **Step 1: Temp-enable USER_PASSWORD_AUTH + get a token**

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
echo "Got token ($(echo -n "$TOKEN" | wc -c | tr -d ' ') chars)"
```

- [ ] **Step 2: Happy path via the CMS subdomain (CloudFront → APIGW → Lambda)**

```bash
curl -sS https://cms.brigitte-le-roux.com/api/media/s3-credentials \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP %{http_code}\n" \
  | jq -r 'if has("access_key_id") and has("secret_access_key") then "BODY OK: has both creds (lengths " + (.access_key_id | length | tostring) + ", " + (.secret_access_key | length | tostring) + ")" else . end'
```

Expected: `HTTP 200` and `BODY OK: has both creds (lengths 20, 40)`. **Do not print the credential values themselves** — only key presence + length.

- [ ] **Step 3: Negative test — no token → 401**

```bash
curl -sSI https://cms.brigitte-le-roux.com/api/media/s3-credentials | head -3
```

Expected: `HTTP/2 401`.

- [ ] **Step 4: Negative test — wrong method → 404**

```bash
curl -sSI -X POST https://cms.brigitte-le-roux.com/api/media/s3-credentials \
  -H "Authorization: Bearer $TOKEN" | head -3
```

Expected: `HTTP/2 404`.

- [ ] **Step 5: Confirm the old upload-url endpoint is gone**

```bash
curl -sSI -X POST https://cms.brigitte-le-roux.com/api/media/upload-url \
  -H "Authorization: Bearer $TOKEN" | head -3
```

Expected: `HTTP/2 404`. Confirms the old route was removed.

- [ ] **Step 6: Verify the IAM user creds actually work (uses Sveltia's eventual upload path)**

```bash
CREDS=$(curl -sS https://cms.brigitte-le-roux.com/api/media/s3-credentials \
  -H "Authorization: Bearer $TOKEN")
AKI=$(echo "$CREDS" | jq -r '.access_key_id')
SAK=$(echo "$CREDS" | jq -r '.secret_access_key')

# Upload a tiny test file using ONLY those creds (no other AWS profile fallback)
printf '%%PDF-1.4\n%%EOF\n' > /tmp/p7-smoke.pdf
AWS_ACCESS_KEY_ID="$AKI" AWS_SECRET_ACCESS_KEY="$SAK" AWS_REGION=eu-central-1 \
  aws s3 cp /tmp/p7-smoke.pdf s3://brigitte-le-roux-website/pdfs/__plan7_smoke.pdf

# Verify
aws s3 ls s3://brigitte-le-roux-website/pdfs/__plan7_smoke.pdf

# Negative test: those creds CANNOT delete (no s3:DeleteObject in the policy)
AWS_ACCESS_KEY_ID="$AKI" AWS_SECRET_ACCESS_KEY="$SAK" AWS_REGION=eu-central-1 \
  aws s3 rm s3://brigitte-le-roux-website/pdfs/__plan7_smoke.pdf 2>&1 | head -3

# Negative test: those creds CANNOT touch other prefixes
AWS_ACCESS_KEY_ID="$AKI" AWS_SECRET_ACCESS_KEY="$SAK" AWS_REGION=eu-central-1 \
  aws s3 cp /tmp/p7-smoke.pdf s3://brigitte-le-roux-website/cms/EVIL.pdf 2>&1 | head -3

# Clean up the smoke-test file using the admin's main credentials (no env override)
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION
aws s3 rm s3://brigitte-le-roux-website/pdfs/__plan7_smoke.pdf

# Wipe scratch
rm -f /tmp/p7-smoke.pdf
unset CREDS AKI SAK
```

Expected:
- The upload to `pdfs/` succeeds (proves the IAM user's PutObject works)
- `aws s3 ls` shows the file
- The delete attempt returns `AccessDenied` (proves the policy doesn't include `s3:DeleteObject`)
- The upload to `cms/` returns `AccessDenied` (proves the policy is scoped to the three prefixes)
- Final `aws s3 rm` (using the admin's creds) cleans up

- [ ] **Step 7: Restore Cognito App Client auth flows**

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --output json | rtk proxy grep ExplicitAuthFlows
```

Expected: prints `"ExplicitAuthFlows": ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]`.

- [ ] **Step 8: Clear sensitive values from the shell**

```bash
unset TOKEN APP_CLIENT_ID USER_POOL_ID
history -d $(history 1) 2>/dev/null || true
```

---

### Task 8: Stage, commit, push

Three logical commits — Lambda source, Makefile, Terraform (incl. iam.tf).

- [ ] **Step 1: Commit the Lambda source refactor**

```bash
git add packages/functions/media-manager/

git status --short
```

Expected: shows
- modified `index.mjs`
- modified `package.json`
- modified `yarn.lock`
- new `run.sh`
- deletes for `lib/presigner.mjs`, `lib/invalidator.mjs`, `lib/validation.mjs`

```bash
git commit -m "$(cat <<'EOF'
refactor(functions): rewrite media-manager as LWA + Hono (ZIP package)

The presigned-URL design from Plan 5 doesn't fit Sveltia (no custom
media-library plugin API; Sveltia's built-in S3 needs raw IAM creds).
media-manager now issues IAM creds for a dedicated upload user via
GET /api/media/s3-credentials, gated by API Gateway's Cognito JWT
authorizer.

Packaging stays as ZIP (no Docker, no ECR) — AWS Lambda Web Adapter
is attached via the AWS-published public Lambda Layer
(LambdaAdapterLayerArm64:27). Handler: run.sh -> node index.mjs.
LWA wraps the runtime via AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap and
forwards API Gateway invocations to localhost:8080 where the Hono
server listens.

- packages/functions/media-manager/index.mjs
  Rewritten as a Hono server. Reads sveltia-media-manager-credentials
  SSM SecureString at module load, caches in module scope, serves the
  JSON on every authenticated GET.

- packages/functions/media-manager/run.sh
  3-line bash entrypoint. Executable bit preserved in the ZIP.

- packages/functions/media-manager/package.json
  Bumped to 2.0.0 to signal the breaking refactor. Dropped
  @aws-sdk/client-s3, @aws-sdk/s3-request-presigner,
  @aws-sdk/client-cloudfront. Added hono + @hono/node-server. Build
  script keeps esbuild (same as github-gateway). New yarn dev script
  runs the Hono server locally for testing.

- packages/functions/media-manager/lib/
  Deleted: presigner.mjs, invalidator.mjs, validation.mjs.
EOF
)"
```

- [ ] **Step 2: Commit the Makefile change**

```bash
git add packages/functions/Makefile

git commit -m "$(cat <<'EOF'
build(functions): include run.sh in the ZIP when present (LWA-based handlers)

Existing Makefile zipped only dist/index.mjs for each function. Extended
to append <function>/run.sh to the ZIP if the file exists. github-gateway
has no run.sh, so its ZIP is unchanged; media-manager (post-Plan-7) now
ships a run.sh as the Lambda handler entrypoint.

zip -j strips paths so run.sh lands at the ZIP root, where Lambda's
handler resolution expects it.
EOF
)"
```

- [ ] **Step 3: Commit the Terraform refactor**

```bash
git add packages/infrastructure/functions.tf packages/infrastructure/iam.tf

git status --short
```

```bash
git commit -m "$(cat <<'EOF'
infra(cms): switch media-manager to LWA + add Sveltia upload IAM user

media-manager Lambda:

- Refactored from event-handler ZIP to LWA-wrapped ZIP. Handler is
  run.sh (a bash script that exec's `node index.mjs`); the AWS-published
  Lambda Layer LambdaAdapterLayerArm64:27 is attached so LWA boots
  before the user code and proxies API Gateway invocations to the Hono
  server on localhost:8080.

- IAM execution policy stripped to ssm:GetParameter +
  kms:Decrypt(aws/ssm) on the new sveltia-media-manager-credentials
  SSM SecureString. Dropped s3:PutObject + cloudfront:CreateInvalidation
  (the old presigned-URL flow's permissions; no longer needed).

- Env vars on the Lambda: AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,
  MEDIA_MANAGER_CREDENTIALS_PARAM, PORT=8080. Dropped BUCKET_NAME +
  CLOUDFRONT_DISTRIBUTION_ID.

- cms_trigger integration: route changed from
  POST /api/media/upload-url -> GET /api/media/s3-credentials.

New IAM user `brigitte-le-roux-website-sveltia-media-manager`:

- Inline policy: s3:ListBucket on the website bucket (limited to the
  pdfs/* | img/* | data/* prefixes via condition) + s3:PutObject on
  those three prefixes. Nothing else — no DeleteObject, no other
  prefixes, no IAM, no CloudFront.

- Access key + secret are NOT in Terraform state. Generated via
  `aws iam create-access-key` and piped directly into SSM SecureString
  brigitte-le-roux-website.sveltia-media-manager-credentials in a
  single command (secret never touches disk).

End-to-end smoke test passed: GET /api/media/s3-credentials with a
valid Cognito id_token returns the access key + secret; the creds
upload to pdfs/ but cannot delete or write outside the allowed prefixes;
401 without token; old POST /api/media/upload-url returns 404.
EOF
)"
```

- [ ] **Step 4: Confirm history**

```bash
git log --oneline -5
```

Expected: three new commits on top of `bd0f420` (or wherever main was before this batch).

- [ ] **Step 5: Push to main**

```bash
git push origin main 2>&1 | tail -3
```

Expected: succeeds.

- [ ] **Step 6: Confirm the deploy-website workflow did NOT run**

```bash
gh run list --workflow=deploy-website.yml --limit 1 --json status,headSha,createdAt
```

Expected: the most recent run pre-dates this push (path filter `packages/website/**` excludes everything in this batch).

---

## Self-Review

**Spec coverage** (against rewritten spec §4):

| Spec requirement | Plan task |
| --- | --- |
| media-manager Lambda packaged with LWA (ZIP + AWS Layer, arm64) | Tasks 3 + 4 + 5 |
| `GET /api/media/s3-credentials` endpoint, Cognito JWT required | Tasks 3 + 5 (route) + 7 (smoke test) |
| Dedicated IAM user `brigitte-le-roux-website-sveltia-media-manager` with PutObject + ListBucket on the three prefixes | Task 2 |
| SSM SecureString `brigitte-le-roux-website.sveltia-media-manager-credentials` (JSON: access_key_id + secret_access_key) | Task 2 |
| Lambda IAM scoped to ssm:GetParameter + kms:Decrypt on the new SecureString only | Task 5 |
| S3 bucket CORS unchanged | (no change — Plan 5's CORS rule covers Sveltia uploads as-is) |
| Old POST /api/media/upload-url removed | Tasks 5 (HCL) + 7 (verification) |
| Same code runs locally and in Lambda | Task 3 (yarn dev) + smoke test |

**Out of scope** (handled in later plans):

- Sveltia frontend (loader HTML, OAuth shim, credentials bootstrap, config.yml) — Plan 8.
- API hardening (force traffic through CloudFront via origin custom header) — Plan 9.
- Per-user attribution in media-manager logs (LWA request-context passthrough) — small follow-up.

**Placeholder scan:** every code step has a concrete code block; every command step has the exact command + expected output. No "implement later" / "add error handling" / "TBD" phrasings.

**Known gotchas + mitigations:**

- IAM user creation may be denied by the dev role → Task 2 Step 2 has the manual-console fallback documented.
- ZIP→ZIP swap is in-place; the Lambda's `package_type` doesn't change, so no recreation forced.
- Route key (`POST /api/media/upload-url` → `GET /api/media/s3-credentials`) is `ForceNew` in the API Gateway provider, so that resource is destroyed + recreated. ~10s of 404 on the new path during apply is normal.
- The `run.sh` bit must be executable. Task 3 Step 2 explicitly `chmod +x`'s it; git tracks the +x permission via filemode.
- LWA layer version `:27` is pinned. Future bump is a deliberate single-line change in `local.lwa_layer_arn`.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-23-media-manager-lwa-refactor.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
