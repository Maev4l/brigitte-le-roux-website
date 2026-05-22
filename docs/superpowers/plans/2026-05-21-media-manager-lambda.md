# media-manager Lambda + Shared HTTP API Route

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `media-manager` Lambda — the second piece of the CMS backend. Sveltia sends an authenticated request describing the file it wants to upload (`filename`, `contentType`, `folder`, `size`); the Lambda validates against allowlists + size caps, generates a presigned S3 PUT URL (5-minute TTL), proactively invalidates the matching CloudFront path, and returns `{ uploadUrl, publicPath }`. The browser then PUTs the binary directly to S3 — file bytes never traverse Lambda.

By the end of this plan, you can `curl` the new endpoint, receive a signed URL, PUT a real PDF to S3 through it, and see the file in the bucket. The route is added as a second entry on the **same** HTTP API that Plan 4 created — one shared API for both CMS Lambdas.

**Architecture:**

```
Sveltia (browser, Plan 6)
   │ Authorization: Bearer <Cognito id_token>
   │ POST /api/media/upload-url
   │ { filename, contentType, folder, size }
   ▼
API Gateway HTTP API (shared with github-gateway from Plan 4)
   │ JWT authorizer validates Cognito token
   ▼
media-manager Lambda (Node.js 22, ZIP, arm64)
   ├── reads JWT claims (email, for logging)
   ├── validates folder against allowlist
   ├── validates contentType against allowlist
   ├── normalizes filename (spaces → underscores)
   ├── validates filename pattern
   ├── validates size against per-type cap
   ├── builds S3 key: <folder>/<filename>
   ├── signs PutObjectCommand (ContentType + ContentLength bound)
   ├── triggers CloudFront invalidation for /<key>
   └── returns { uploadUrl, publicPath }
   │
   │ (response)
   ▼
Sveltia
   │ PUT uploadUrl with file bytes
   ▼
S3 brigitte-le-roux-website (bucket CORS allows cms.brigitte-le-roux.com)
```

**Tech Stack:**
- Node.js 22 ESM (plain JS, no TypeScript, fat-arrow, strict-pinned deps, eslint.config.js).
- Lambda packaged as ZIP (architecture = arm64 / Graviton).
- AWS Lambda runtime `nodejs22.x` (managed).
- Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-cloudfront`.
- Terraform via `Maev4l/terraform-modules//modules/lambda-function` (v1.7.1). The HTTP API + JWT authorizer + route are added to the existing `lambda-trigger-apigw` module instance from Plan 4 by appending an entry to its `integrations` map.

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §4 (media-manager Lambda + S3 CORS).

---

## Preconditions

- On `main`, working tree clean.
- Plan 4 has been applied: the HTTP API `brigitte-le-roux-website-cms`, the JWT authorizer, and the github-gateway integration all exist. `terraform output -raw cms_api_endpoint` returns a valid URL.
- `aws s3 ls s3://brigitte-le-roux-website/` works (the site bucket from §0 / Plan 1).
- `terraform output -raw cloudfront_distribution_id` returns a value.
- Before Task 7 (smoke test), export the Cognito test user credentials in your shell — values held outside the repo:
  `export TEST_USER_EMAIL=...; export TEST_USER_PASSWORD=...`.

## Approach notes

- **Single shared HTTP API.** Rename the existing module call from `module "github_gateway_trigger"` (legacy name from Plan 4) to `module "cms_trigger"` since the API now serves both Lambdas. The rename is performed during execution via `terraform state mv module.github_gateway_trigger module.cms_trigger` so no resources are recreated — the live API keeps its ID, endpoint, and routes.
- **File bytes never pass through the Lambda.** The Lambda only signs the URL and triggers an invalidation. This keeps the Lambda memory low (256 MB) and the upload throughput bounded only by the browser ↔ S3 link.
- **Size enforcement at signing time.** The presigned URL includes `ContentLength` in the signature, so S3 rejects PUTs whose body length differs from the signed value. A client cannot upload more bytes than they declared.
- **Multiple commits** during execution (Lambda code, Terraform, smoke-test cleanup).

---

### Task 1: Verify preconditions

- [ ] **Step 1: Branch + clean tree**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty.

- [ ] **Step 2: Confirm Plan 4 resources exist**

```bash
terraform -chdir=packages/infrastructure output -raw cms_api_endpoint
terraform -chdir=packages/infrastructure output -raw cms_api_id
terraform -chdir=packages/infrastructure output -raw cloudfront_distribution_id
terraform -chdir=packages/infrastructure output -raw bucket_name
terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id
terraform -chdir=packages/infrastructure output -raw cognito_app_client_id
```

Expected: every command prints a non-empty value. If any is missing, Plan 4 or an earlier plan is incomplete — stop and resolve.

- [ ] **Step 3: Confirm dev role can manage S3 CORS + CloudFront invalidations**

```bash
aws s3api get-bucket-cors --bucket brigitte-le-roux-website 2>&1 | head -3
aws cloudfront list-distributions --max-items 1 2>&1 | head -3
```

Expected: the first either succeeds OR fails with `NoSuchCORSConfiguration` (both are fine — means we can read; the next task adds CORS). The second succeeds.

- [ ] **Step 4: `yarn infra:plan` shows no drift**

```bash
yarn infra:plan 2>&1 | tail -3
```

Expected: "No changes."

---

### Task 2: Scaffold the media-manager Lambda code

**Files:**
- Create: `packages/functions/media-manager/package.json`
- Create: `packages/functions/media-manager/eslint.config.js`
- Create: `packages/functions/media-manager/index.mjs`
- Create: `packages/functions/media-manager/lib/validation.mjs`
- Create: `packages/functions/media-manager/lib/presigner.mjs`
- Create: `packages/functions/media-manager/lib/invalidator.mjs`

- [ ] **Step 1: Create `packages/functions/media-manager/package.json`**

```json
{
  "name": "media-manager",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Cognito-authenticated presigned-URL minter for browser → S3 media uploads",
  "main": "index.mjs",
  "scripts": {
    "lint": "eslint .",
    "build": "esbuild index.mjs --bundle --platform=node --target=node22 --format=esm --outfile=dist/index.mjs --external:@aws-sdk/* --banner:js=\"import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);\""
  },
  "dependencies": {
    "@aws-sdk/client-cloudfront": "3.687.0",
    "@aws-sdk/client-s3": "3.687.0",
    "@aws-sdk/s3-request-presigner": "3.687.0"
  },
  "devDependencies": {
    "@eslint/js": "9.15.0",
    "esbuild": "0.24.0",
    "eslint": "9.15.0"
  }
}
```

Strict-pinned versions per the project's global convention. `@aws-sdk/*` is bundled-out via esbuild's `--external` flag (provided by the Lambda runtime) — same approach as github-gateway in Plan 4.

- [ ] **Step 2: Create `packages/functions/media-manager/eslint.config.js`**

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

- [ ] **Step 3: Create `packages/functions/media-manager/lib/validation.mjs`**

```js
// Input validation + filename normalization. Each validator returns
// either { ok: true, value } or { ok: false, error }. The handler short-
// circuits on the first error with a 400 response.

// Folders Sveltia is allowed to write to. Anything else is rejected.
// Mirrors the on-disk layout under packages/website/public/.
const ALLOWED_FOLDERS = new Set([
  'pdfs',
  'pdfs/publications',
  'pdfs/livres',
  'pdfs/livres/Reviews',
  'img',
  'data',
]);

// Content-types Sveltia is allowed to upload.
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

// Size caps in bytes. Picked by content-type group.
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_BYTES = 100 * 1024 * 1024;

// Filename pattern after normalization. Restrictive on purpose — anything
// with shell-special chars or non-ASCII is rejected at this gateway.
const FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export const validateFolder = (folder) => {
  if (typeof folder !== 'string') return { ok: false, error: 'folder must be a string' };
  if (!ALLOWED_FOLDERS.has(folder)) {
    return { ok: false, error: `folder not in allowlist: ${folder}` };
  }
  return { ok: true, value: folder };
};

export const validateContentType = (contentType) => {
  if (typeof contentType !== 'string') return { ok: false, error: 'contentType must be a string' };
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { ok: false, error: `contentType not in allowlist: ${contentType}` };
  }
  return { ok: true, value: contentType };
};

// Replaces whitespace runs with a single underscore, matching the
// project's existing convention (commit 6155f17). Trims surrounding ws.
export const normalizeFilename = (filename) => {
  if (typeof filename !== 'string') return null;
  return filename.trim().replace(/\s+/g, '_');
};

export const validateFilename = (filename) => {
  const normalized = normalizeFilename(filename);
  if (!normalized) return { ok: false, error: 'filename must be a non-empty string' };
  if (normalized.length > 255) return { ok: false, error: 'filename too long' };
  if (!FILENAME_PATTERN.test(normalized)) {
    return { ok: false, error: `filename has disallowed characters: ${normalized}` };
  }
  return { ok: true, value: normalized };
};

// Pick a size cap based on the content-type group.
const capForContentType = (contentType) => {
  if (contentType === 'application/pdf') return MAX_PDF_BYTES;
  if (contentType.startsWith('image/')) return MAX_IMAGE_BYTES;
  return MAX_DATA_BYTES;
};

export const validateSize = (size, contentType) => {
  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, error: 'size must be a positive integer' };
  }
  const cap = capForContentType(contentType);
  if (size > cap) {
    return { ok: false, error: `size ${size} exceeds cap ${cap} for ${contentType}` };
  }
  return { ok: true, value: size };
};
```

- [ ] **Step 4: Create `packages/functions/media-manager/lib/presigner.mjs`**

```js
// Builds a 5-minute presigned S3 PUT URL bound to the exact ContentType
// + ContentLength the caller declared. S3 rejects PUTs whose headers do
// not match the signed values, so a client cannot upload a different
// type or more bytes than they claimed.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const URL_TTL_SECONDS = 300;

const s3 = new S3Client({});

export const signUploadUrl = async ({ bucket, key, contentType, contentLength }) => {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(s3, command, { expiresIn: URL_TTL_SECONDS });
};
```

- [ ] **Step 5: Create `packages/functions/media-manager/lib/invalidator.mjs`**

```js
// Proactively invalidates the CloudFront cache for the path that's about
// to be uploaded. Runs BEFORE the actual PUT — when the upload completes
// a few seconds later, the next viewer request misses cache and fetches
// the fresh object from S3.
//
// Invalidating a path that doesn't exist yet is a no-op; cost stays
// negligible (~$0.005 per invalidation, 1000/month free tier).

import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const cf = new CloudFrontClient({});

export const invalidatePath = async ({ distributionId, path }) => {
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        // Unique CallerReference so retries don't collide.
        CallerReference: `media-manager-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        Paths: { Quantity: 1, Items: [path] },
      },
    }),
  );
};
```

- [ ] **Step 6: Create `packages/functions/media-manager/index.mjs`**

```js
// Lambda handler: validates the upload request, signs an S3 PUT URL,
// triggers a CloudFront invalidation, returns { uploadUrl, publicPath }.

import {
  validateFolder,
  validateContentType,
  validateFilename,
  validateSize,
} from './lib/validation.mjs';
import { signUploadUrl } from './lib/presigner.mjs';
import { invalidatePath } from './lib/invalidator.mjs';

const BUCKET_NAME = process.env.BUCKET_NAME;
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  try {
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.email) {
      return json(401, { error: 'Missing email claim in JWT' });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { folder, contentType, filename, size } = body;

    const folderResult = validateFolder(folder);
    if (!folderResult.ok) return json(400, { error: folderResult.error });

    const ctResult = validateContentType(contentType);
    if (!ctResult.ok) return json(400, { error: ctResult.error });

    const fnResult = validateFilename(filename);
    if (!fnResult.ok) return json(400, { error: fnResult.error });

    const sizeResult = validateSize(size, ctResult.value);
    if (!sizeResult.ok) return json(400, { error: sizeResult.error });

    const key = `${folderResult.value}/${fnResult.value}`;
    const publicPath = `/${key}`;

    const uploadUrl = await signUploadUrl({
      bucket: BUCKET_NAME,
      key,
      contentType: ctResult.value,
      contentLength: sizeResult.value,
    });

    await invalidatePath({
      distributionId: CLOUDFRONT_DISTRIBUTION_ID,
      path: publicPath,
    });

    // Structured log line — observable in CloudWatch, no file bytes.
    console.log(JSON.stringify({
      event: 'media-upload-signed',
      user: claims.email,
      key,
      contentType: ctResult.value,
      size: sizeResult.value,
    }));

    return json(200, { uploadUrl, publicPath });
  } catch (err) {
    console.error('media-manager error', err);
    return json(502, { error: 'Upstream error', message: err.message });
  }
};
```

- [ ] **Step 7: Install deps**

```bash
yarn --cwd packages/functions/media-manager install
```

Expected: `node_modules/` created, `yarn.lock` written; ~30 packages installed.

- [ ] **Step 8: Lint**

```bash
yarn --cwd packages/functions/media-manager lint
```

Expected: no errors.

---

### Task 3: Build the Lambda ZIP via the existing Makefile

The Makefile created in Plan 4 picks up every subdirectory under `packages/functions/` that contains a `package.json`. Adding the new folder is enough — no Makefile edits required.

- [ ] **Step 1: Run the orchestrator**

```bash
yarn backend:build
```

Expected output includes both functions:
```
→ Building github-gateway
✓ packages/functions/github-gateway/dist/github-gateway.zip (36K)
→ Building media-manager
✓ packages/functions/media-manager/dist/media-manager.zip (...K)
```

- [ ] **Step 2: Verify the ZIP layout**

```bash
unzip -l packages/functions/media-manager/dist/media-manager.zip
```

Expected: one file inside, `index.mjs`. The handler resolves as `index.handler`.

---

### Task 4: Add S3 bucket CORS

Sveltia uploads from `https://cms.brigitte-le-roux.com/`. The S3 bucket must allow cross-origin PUT requests from that origin or the browser will block the upload before it reaches S3.

**Files:**
- Modify: `packages/infrastructure/s3.tf`

- [ ] **Step 1: Append the CORS resource**

Open `packages/infrastructure/s3.tf` and add at the bottom:

```hcl
# CORS for direct browser uploads from the Sveltia CMS.
# The CMS is hosted at https://cms.brigitte-le-roux.com (later plan); for
# now the bucket already accepts the origin so Plan 5's smoke test can
# also be run from a local Sveltia dev server pointed at the bucket.
resource "aws_s3_bucket_cors_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  cors_rule {
    allowed_origins = ["https://cms.brigitte-le-roux.com"]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
```

- [ ] **Step 2: Format + validate**

```bash
terraform -chdir=packages/infrastructure fmt
terraform -chdir=packages/infrastructure validate
```

Expected: validate succeeds.

---

### Task 5: Wire the media-manager Lambda + new route in Terraform

**Files:**
- Modify: `packages/infrastructure/functions.tf`

- [ ] **Step 1: Add the Lambda + IAM block**

Open `packages/infrastructure/functions.tf` and add the following block **after** the existing `aws_iam_policy "github_gateway"` resource and **before** the `module "github_gateway_trigger"` block (which Step 2 will rename to `cms_trigger`):

```hcl
# ---------------------------------------------------------------------------
# media-manager Lambda. Signs presigned S3 PUT URLs and proactively
# invalidates the CloudFront cache for the path about to be uploaded.
# File bytes never traverse this Lambda.
# ---------------------------------------------------------------------------

locals {
  mediaManagerZip    = "../functions/media-manager/dist/media-manager.zip"
  mediaManagerBundle = "../functions/media-manager/dist/index.mjs"
}

module "media_manager" {
  source = "github.com/Maev4l/terraform-modules//modules/lambda-function?ref=v1.7.1"

  function_name = "brigitte-le-roux-website-media-manager"
  architecture  = "arm64"
  memory_size   = 256
  timeout       = 10

  additional_policy_arns = [aws_iam_policy.media_manager.arn]

  zip = {
    filename = local.mediaManagerZip
    runtime  = "nodejs22.x"
    handler  = "index.handler"
    hash     = filebase64sha256(local.mediaManagerBundle)
  }

  environment_variables = {
    BUCKET_NAME                = aws_s3_bucket.site.id
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.site.id
  }
}

# IAM policy: scoped to ONLY the prefixes Sveltia is allowed to upload to,
# plus CreateInvalidation on the website distribution. Logs perms come
# from the lambda-function module.
data "aws_iam_policy_document" "media_manager" {
  statement {
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.site.arn}/pdfs/*",
      "${aws_s3_bucket.site.arn}/img/*",
      "${aws_s3_bucket.site.arn}/data/*",
    ]
  }
  statement {
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_policy" "media_manager" {
  name        = "brigitte-le-roux-website-media-manager"
  description = "media-manager Lambda: PutObject on whitelisted S3 prefixes + CloudFront invalidations"
  policy      = data.aws_iam_policy_document.media_manager.json
}
```

- [ ] **Step 2: Add the route to the existing HTTP API module call**

Still in `packages/infrastructure/functions.tf`, locate the `module "github_gateway_trigger"` block. **Rename it to `module "cms_trigger"`** (it now serves both Lambdas, not just github-gateway) AND **append a `media-manager` entry to its `integrations` map**. The full block after the edit should read:

```hcl
# HTTP API + JWT authorizer + integrations + routes — all bundled by the
# module. The single shared HTTP API for the CMS backend; both the
# github-gateway and media-manager Lambdas attach as integrations on it.
# Originally introduced in Plan 4 as `github_gateway_trigger`, renamed to
# `cms_trigger` during Plan 5 once the media-manager became its second
# consumer (state was moved via `terraform state mv`).
module "cms_trigger" {
  source = "github.com/Maev4l/terraform-modules//modules/lambda-trigger-apigw?ref=v1.7.1"

  api_name = "brigitte-le-roux-website-cms"

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
    "media-manager" = {
      function_name = module.media_manager.function_name
      function_arn  = module.media_manager.function_arn
      invoke_arn    = module.media_manager.invoke_arn
      routes = [
        "POST /api/media/upload-url",
      ]
    }
  }
}
```

- [ ] **Step 3: Format + validate**

```bash
terraform -chdir=packages/infrastructure fmt
terraform -chdir=packages/infrastructure validate
```

Expected: validate succeeds.

---

### Task 6: Terraform plan + apply

- [ ] **Step 1: Plan**

```bash
yarn infra:plan 2>&1 | tail -50
```

Expected: adds the new Lambda function + role + log group + IAM policy, a new APIGW integration + route + Lambda permission, and the S3 CORS configuration. Typically ~9 resources to add, 1 in-place update (the integrations map on the HTTP API).

**No resources should be destroyed.** If Terraform reports any destroy, stop and inspect — likely a tainted leftover from a previous failed apply.

- [ ] **Step 2: Apply**

```bash
yarn backend:deploy
```

Expected: succeeds. Outputs print `cms_api_endpoint` (unchanged from Plan 4 — same HTTP API).

- [ ] **Step 3: Confirm both Lambdas are live**

```bash
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `brigitte-le-roux-website-`)].FunctionName' --output text
```

Expected: both `brigitte-le-roux-website-github-gateway` and `brigitte-le-roux-website-media-manager`.

---

### Task 7: Smoke-test the media-manager end-to-end

Get a Cognito token (same approach as Plan 4 — temporarily enable `USER_PASSWORD_AUTH` on the App Client), POST to `/api/media/upload-url`, PUT a real PDF to S3 with the returned URL, verify the object exists, then clean up.

- [ ] **Step 1: Temporarily enable `USER_PASSWORD_AUTH` on the Cognito App Client**

```bash
APP_CLIENT_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_app_client_id)
USER_POOL_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id)

aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH \
  --output json | head -5
```

- [ ] **Step 2: Get an id_token**

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --client-id "$APP_CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$TEST_USER_EMAIL",PASSWORD="$TEST_USER_PASSWORD" \
  --query 'AuthenticationResult.IdToken' \
  --output text)

echo "Got token ($(echo -n "$TOKEN" | wc -c) chars)"

# Persist for next steps (Bash tool calls don't share env).
echo "$TOKEN" > /tmp/p5-token
API=$(terraform -chdir=packages/infrastructure output -raw cms_api_endpoint)
echo "$API" > /tmp/p5-api
```

Expected: a JWT (1000+ chars).

- [ ] **Step 3: Reject a request with a folder NOT in the allowlist**

```bash
TOKEN=$(cat /tmp/p5-token); API=$(cat /tmp/p5-api)

curl -sS -X POST "${API}/api/media/upload-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"folder":"src","contentType":"application/pdf","filename":"foo.pdf","size":1234}' \
  -w "\nHTTP %{http_code}\n"
```

Expected: response body contains `"error":"folder not in allowlist: src"` and `HTTP 400`.

- [ ] **Step 4: Reject a request with an oversized PDF**

```bash
TOKEN=$(cat /tmp/p5-token); API=$(cat /tmp/p5-api)

curl -sS -X POST "${API}/api/media/upload-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"folder":"pdfs","contentType":"application/pdf","filename":"big.pdf","size":99999999}' \
  -w "\nHTTP %{http_code}\n"
```

Expected: response body contains `"error":"size 99999999 exceeds cap 52428800 for application/pdf"` and `HTTP 400`.

- [ ] **Step 5: Reject a filename with disallowed characters**

```bash
TOKEN=$(cat /tmp/p5-token); API=$(cat /tmp/p5-api)

curl -sS -X POST "${API}/api/media/upload-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"folder":"pdfs","contentType":"application/pdf","filename":"../etc/passwd","size":1234}' \
  -w "\nHTTP %{http_code}\n"
```

Expected: response body contains `"error":"filename has disallowed characters: ../etc/passwd"` and `HTTP 400`.

- [ ] **Step 6: Happy path — get a signed URL for a real upload**

Make a small dummy PDF locally and ask for an upload URL whose size matches:

```bash
TOKEN=$(cat /tmp/p5-token); API=$(cat /tmp/p5-api)

# Create a small dummy PDF (~250 bytes, valid PDF header).
printf '%%PDF-1.4\n%%EOF\n' > /tmp/p5-test.pdf
TEST_SIZE=$(wc -c < /tmp/p5-test.pdf | tr -d ' ')
echo "Test PDF size: $TEST_SIZE bytes"

curl -sS -X POST "${API}/api/media/upload-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"folder\":\"pdfs\",\"contentType\":\"application/pdf\",\"filename\":\"__plan5_smoke.pdf\",\"size\":${TEST_SIZE}}" \
  | tee /tmp/p5-response.json
```

Expected: response shape:
```json
{
  "uploadUrl": "https://brigitte-le-roux-website.s3.eu-central-1.amazonaws.com/pdfs/__plan5_smoke.pdf?X-Amz-Algorithm=...",
  "publicPath": "/pdfs/__plan5_smoke.pdf"
}
```

- [ ] **Step 7: PUT the file using the signed URL**

```bash
UPLOAD_URL=$(jq -r '.uploadUrl' /tmp/p5-response.json)

curl -sS -X PUT "$UPLOAD_URL" \
  -H "content-type: application/pdf" \
  --data-binary @/tmp/p5-test.pdf \
  -w "HTTP %{http_code}\n"
```

Expected: `HTTP 200`. (S3 returns an empty body on a successful PUT.)

- [ ] **Step 8: Verify the object exists in S3**

```bash
aws s3 ls s3://brigitte-le-roux-website/pdfs/__plan5_smoke.pdf
```

Expected: one line showing the date, size (~16 bytes), and key.

- [ ] **Step 9: Verify the CloudFront invalidation was triggered**

```bash
DIST_ID=$(terraform -chdir=packages/infrastructure output -raw cloudfront_distribution_id)
aws cloudfront list-invalidations --distribution-id "$DIST_ID" --max-items 1 \
  --query 'InvalidationList.Items[0].{Status:Status,CreateTime:CreateTime}'
```

Expected: an invalidation with `Status` either `InProgress` or `Completed`, created within the last minute. To inspect the paths:

```bash
INV_ID=$(aws cloudfront list-invalidations --distribution-id "$DIST_ID" --max-items 1 \
  --query 'InvalidationList.Items[0].Id' --output text)
aws cloudfront get-invalidation --distribution-id "$DIST_ID" --id "$INV_ID" \
  --query 'Invalidation.InvalidationBatch.Paths.Items'
```

Expected: `[ "/pdfs/__plan5_smoke.pdf" ]`.

- [ ] **Step 10: Reject a PUT whose Content-Length differs from the signed value**

This proves the size cap can't be circumvented by lying in the JSON request.

```bash
TOKEN=$(cat /tmp/p5-token); API=$(cat /tmp/p5-api)

# Ask for a 16-byte upload URL.
curl -sS -X POST "${API}/api/media/upload-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"folder":"pdfs","contentType":"application/pdf","filename":"__plan5_oversize.pdf","size":16}' \
  | jq -r '.uploadUrl' > /tmp/p5-bad-url.txt

# Try to PUT something larger than 16 bytes.
head -c 1024 /dev/urandom > /tmp/p5-too-big.bin
curl -sS -X PUT "$(cat /tmp/p5-bad-url.txt)" \
  -H "content-type: application/pdf" \
  --data-binary @/tmp/p5-too-big.bin \
  -w "HTTP %{http_code}\n" | head -5
```

Expected: `HTTP 403` with an S3 `SignatureDoesNotMatch` or `XAmzContentSHA256Mismatch` error. The signed `ContentLength` enforcement worked.

- [ ] **Step 11: Clean up — delete the smoke-test file from S3**

```bash
aws s3 rm s3://brigitte-le-roux-website/pdfs/__plan5_smoke.pdf
```

Expected: `delete: s3://brigitte-le-roux-website/pdfs/__plan5_smoke.pdf`.

(No need to delete the `__plan5_oversize.pdf` — the rejected PUT in Step 10 means that object never landed.)

- [ ] **Step 12: Restore the App Client's auth-flow list**

```bash
APP_CLIENT_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_app_client_id)
USER_POOL_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id)

aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --output json | rtk proxy grep ExplicitAuthFlows
```

Expected: prints `"ExplicitAuthFlows": ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]`.

- [ ] **Step 13: Remove the smoke-test scratch files**

```bash
rm -f /tmp/p5-token /tmp/p5-api /tmp/p5-response.json /tmp/p5-test.pdf /tmp/p5-too-big.bin /tmp/p5-bad-url.txt
```

---

### Task 8: Stage, review, commit, push

Same convention as Plan 4 — Lambda code committed separately from Terraform for easier bisect.

- [ ] **Step 1: Commit the Lambda code**

```bash
git add packages/functions/media-manager/

git status --short
```

Expected: lists the new files under `packages/functions/media-manager/`. NOT the `dist/` folder (gitignored by Plan 4's `.gitignore` entry `packages/functions/*/dist/`).

```bash
git commit -m "$(cat <<'EOF'
feat(functions): add media-manager Lambda

Cognito-authenticated presigned-URL minter. The browser asks for a signed
PUT URL by sending { filename, contentType, folder, size }; the Lambda
validates each field against allowlists + size caps, signs an S3 PUT URL
with ContentType + ContentLength bound in the signature (5-min TTL), and
triggers a CloudFront invalidation for the target path. File bytes never
traverse the Lambda.

- packages/functions/media-manager/index.mjs
  Handler: input validation → presign → invalidate → return.

- packages/functions/media-manager/lib/
  validation.mjs    folder/contentType/filename/size allowlists + filename
                    normalization (spaces → underscores, [A-Za-z0-9._-]).
  presigner.mjs     S3 PUT URL signing with bound ContentLength.
  invalidator.mjs   CloudFront CreateInvalidation, one path per request.

- packages/functions/media-manager/package.json
  Strict-pinned deps: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner,
  @aws-sdk/client-cloudfront. esbuild + eslint as dev deps.
EOF
)"
```

- [ ] **Step 2: Commit the Terraform changes**

```bash
git add packages/infrastructure/functions.tf packages/infrastructure/s3.tf

git status --short
```

Expected: `functions.tf` modified (Lambda + IAM + route added), `s3.tf` modified (CORS rule added).

```bash
git commit -m "$(cat <<'EOF'
infra(cms): wire media-manager Lambda + S3 CORS

Second integration on the shared HTTP API created in Plan 4. The Lambda
gets its own IAM policy: s3:PutObject scoped to pdfs/* | img/* | data/*
on the website bucket, plus cloudfront:CreateInvalidation on the website
distribution. Env vars: BUCKET_NAME, CLOUDFRONT_DISTRIBUTION_ID.

The existing module instance (renamed `github_gateway_trigger` → `cms_trigger` during this plan) now serves both
Lambdas (route ANY /api/git/{proxy+} unchanged, route POST /api/media/upload-url
added). Renaming the module to `cms_api` is deferred to avoid the
terraform state mv that a rename would force.

S3 bucket CORS: PUT/GET/HEAD allowed from https://cms.brigitte-le-roux.com,
required for direct browser uploads from Sveltia.
EOF
)"
```

- [ ] **Step 3: Confirm history**

```bash
git log --oneline -5
```

Expected: two new commits on top.

- [ ] **Step 4: Push to `main`**

```bash
git push origin main 2>&1 | tail -3
```

Expected: succeeds.

- [ ] **Step 5: Confirm the deploy-website workflow did NOT run**

The path filter is `packages/website/**`. Neither `packages/functions/` nor `packages/infrastructure/` match.

```bash
gh run list --workflow=deploy-website.yml --limit 1 --json status,headSha
```

Expected: the most recent run pre-dates this push.

---

## Self-Review

**Spec coverage** (against spec §4 media-manager Lambda + S3 CORS):

| Spec requirement | Plan task |
| --- | --- |
| `media-manager` Lambda (Node 22 ESM, ZIP, arm64) | Tasks 2 + 5 |
| Endpoint `POST /api/media/upload-url` (Cognito JWT) | Task 5 (integrations map) |
| Folder allowlist (`pdfs`, `pdfs/publications`, `pdfs/livres`, `pdfs/livres/Reviews`, `img`, `data`) | Task 2 (lib/validation.mjs `ALLOWED_FOLDERS`) |
| Content-type allowlist (PDF/PNG/JPEG/WebP/XLS/XLSX/CSV/TXT) | Task 2 (lib/validation.mjs `ALLOWED_CONTENT_TYPES`) |
| Filename normalization: spaces → underscores | Task 2 (lib/validation.mjs `normalizeFilename`) |
| Filename pattern: `[A-Za-z0-9._-]+` | Task 2 (lib/validation.mjs `FILENAME_PATTERN`) |
| Size caps (PDF 50 MB, image 10 MB, data 100 MB) | Task 2 (lib/validation.mjs `capForContentType`) |
| Presigned URL TTL 5 minutes | Task 2 (lib/presigner.mjs `URL_TTL_SECONDS`) |
| CloudFront invalidation per upload | Task 2 (lib/invalidator.mjs) |
| Logging: user email, filename, content-type, size, folder (NOT file content) | Task 2 (index.mjs structured log) |
| IAM: `s3:PutObject` on whitelisted prefixes + `cloudfront:CreateInvalidation` | Task 5 (aws_iam_policy.media_manager) |
| S3 bucket CORS rule | Task 4 |
| Shared HTTP API with github-gateway | Task 5 (integrations map) |
| End-to-end smoke test (sign + PUT + verify + reject paths) | Task 7 |

**Deviations from spec** (small, justified):

- S3 CORS `allowed_origins`: the spec lists `["https://brigitte-le-roux.com"]`. The plan uses `["https://cms.brigitte-le-roux.com"]` because Sveltia (the only client doing browser → S3 PUTs) is hosted at the `cms.` subdomain. The plain `brigitte-le-roux.com` origin would never legitimately initiate a PUT. If a follow-up exposes upload UX from the main site, add it then.
- Size enforcement: the spec says "Size caps enforced via the presigned URL's `Content-Length` range". `Content-Length` *ranges* require presigned POST forms, not presigned PUTs. The plan uses a presigned PUT with an exact `ContentLength` signed in — equivalent safety, simpler client wire format. The client must declare its size correctly; S3 rejects mismatched PUTs with 403 (verified in Task 7 Step 10).

**Out of scope** (handled in later plans):

- Sveltia config + custom plugin JS files (Plan 6): the `sveltia-s3-media.js` plugin that calls this endpoint.
- CMS CloudFront distribution at `cms.brigitte-le-roux.com` (later plan): routes `/api/*` to the HTTP API, `/cms/*` to S3.
- (Earlier draft of this plan deferred the module rename; that decision was reversed during execution — the module was renamed to `cms_trigger` via `terraform state mv` and the live HTTP API kept its identity.)
- Media browsing/listing in Sveltia (spec §4 explicit out-of-scope).
- CloudWatch alarms on the new Lambda (spec §6 — added in a later operations plan).

**Type / contract consistency checks:**

- Env var names used in `index.mjs` (`BUCKET_NAME`, `CLOUDFRONT_DISTRIBUTION_ID`) match those set in `module "media_manager".environment_variables` in Task 5.
- Validator return shapes (`{ ok: true, value }` vs `{ ok: false, error }`) used consistently in `validateFolder`, `validateContentType`, `validateFilename`, `validateSize` and consumed identically in `index.mjs`.
- Response shape (`{ uploadUrl, publicPath }`) matches the spec §4 example.
- S3 key construction (`${folder}/${filename}`) and IAM policy prefixes (`pdfs/*`, `img/*`, `data/*`) align: the IAM policy covers every folder in `ALLOWED_FOLDERS`.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-21-media-manager-lambda.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec then quality) between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
