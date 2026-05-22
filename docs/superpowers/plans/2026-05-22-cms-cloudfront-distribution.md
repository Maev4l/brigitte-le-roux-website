# CMS CloudFront Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified CloudFront distribution at `cms.brigitte-le-roux.com` that serves Sveltia (S3 origin, path `/cms/*`) AND proxies the API Gateway HTTP API (custom origin, path `/api/*`). One subdomain, two origins, same-origin Sveltia ↔ API → no CORS preflight.

**Architecture:**

```
the user's browser
   │
   │ https://cms.brigitte-le-roux.com/<anything>
   ▼
CloudFront distribution (us-east-1 cert at cms.brigitte-le-roux.com)
   ├── Behavior: /api/*  → API Gateway origin (HTTPS, port 443)
   │                       Cache: CachingDisabled
   │                       Origin request: AllViewerExceptHostHeader
   │
   └── Behavior: *  (default)  → S3 origin (brigitte-le-roux-website)
                                 Cache: CachingOptimized
                                 Viewer-request CF function:
                                   /          → 302 /cms/
                                   /cms/      → /cms/index.html
                                   /cms/<dir> → /cms/index.html (SPA fallback)
                                   /cms/<f.ext> → leave alone (S3 serves)
                                   anything else → 404
```

The existing `brigitte-le-roux.com` distribution and the new `cms.brigitte-le-roux.com` distribution share the same S3 bucket but each has its own Origin Access Control (OAC). The S3 bucket policy is widened to allow both distribution ARNs.

**Tech Stack:**

- Terraform (existing `packages/infrastructure/` layout)
- AWS CloudFront (custom origin for APIGW, S3 origin via OAC for Sveltia)
- AWS Route 53 (alias records for the new subdomain)
- AWS ACM (cert at `cms.brigitte-le-roux.com` in `us-east-1` — already issued)
- One CloudFront function (viewer-request) for SPA fallback + root redirect

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §1 (Sveltia CMS hosting at `cms.brigitte-le-roux.com`) and §3 (unified subdomain for `/api/*`).

---

## Preconditions

- On `main`, working tree clean.
- Plan 5 has been applied: media-manager Lambda live, `module.cms_trigger.api_endpoint` resolves.
- ACM cert for `cms.brigitte-le-roux.com` exists in `us-east-1` with status `ISSUED`. As of plan-writing: `arn:aws:acm:us-east-1:671123374425:certificate/fba97e58-df50-4fc7-ab77-5ee7da02e185`. The plan looks it up via data source (no ARN hardcoded).
- `terraform -chdir=packages/infrastructure output -raw cloudfront_distribution_id` returns the existing main-site distribution ID.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/infrastructure/cloudfront.tf` | modify | Append CMS distribution + new OAC + new CF function + ACM cert data source alongside the existing main-site resources |
| `packages/infrastructure/cloudfront-cms-function.js` | **NEW** | SPA routing + root redirect for the CMS distribution |
| `packages/infrastructure/s3.tf` | modify | Widen bucket policy to allow both distribution ARNs |
| `packages/infrastructure/dns.tf` | modify | Add A + AAAA records for `cms.brigitte-le-roux.com` |
| `packages/infrastructure/outputs.tf` | modify | Add `cms_url`, `cms_distribution_id`, `cms_distribution_domain` outputs |

The existing `cloudfront.tf` keeps the main-site distribution + its resources; the CMS distribution is appended to the same file (single CloudFront-related file going forward). The existing main-site CF function is renamed `cloudfront-function.js` → `cloudfront-site-function.js` for symmetry with the new `cloudfront-cms-function.js`; the two functions have fundamentally different routing semantics so they stay in separate files.

## Approach notes

- **CloudFront distributions take 5-15 minutes to deploy** on create + every config change. Plan accordingly.
- **DNS propagation** through Route 53 is ~1-2 minutes after the alias record lands.
- **API Gateway origin path**: empty. CloudFront forwards `/api/git/foo` → API Gateway sees `/api/git/foo` → route `ANY /api/git/{proxy+}` matches.
- **No origin path on the S3 origin either.** Sveltia lives at S3 key prefix `cms/*`, and CloudFront paths match those keys directly (`/cms/index.html` → `s3://bucket/cms/index.html`).
- **`disable_execute_api_endpoint` stays `false`** for now — the raw `<api-id>.execute-api.eu-central-1.amazonaws.com` URL remains reachable for smoke testing. Tighten to `true` in a later hardening pass once Plan 7 (Sveltia config) is exercised.

---

### Task 1: Verify preconditions

- [ ] **Step 1: Branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty.

- [ ] **Step 2: Confirm existing CloudFront + S3 + APIGW state**

```bash
terraform -chdir=packages/infrastructure output -raw cloudfront_distribution_id
terraform -chdir=packages/infrastructure output -raw bucket_name
terraform -chdir=packages/infrastructure output -raw cms_api_endpoint
```

Expected: each prints a non-empty value (main-site distribution, site bucket, API endpoint URL).

- [ ] **Step 3: Confirm the ACM cert for `cms.brigitte-le-roux.com` exists in us-east-1**

```bash
aws acm list-certificates --region us-east-1 \
  --query 'CertificateSummaryList[?DomainName==`cms.brigitte-le-roux.com`].[CertificateArn,Status]' \
  --output text
```

Expected: one line, ending in `ISSUED`. If empty or PENDING_VALIDATION, STOP — the cert needs to be created/validated before this plan can proceed.

- [ ] **Step 4: `yarn infra:plan` shows no drift**

```bash
yarn infra:plan 2>&1 | tail -3
```

Expected: contains "No changes."

---

### Task 2: Add the CloudFront viewer-request function for SPA routing

**Files:**
- Create: `packages/infrastructure/cloudfront-cms-function.js`

- [ ] **Step 1: Create the function source file**

Write `packages/infrastructure/cloudfront-cms-function.js`:

```js
// CloudFront viewer-request function for the CMS distribution.
// - Root path redirects to /cms/ (Sveltia's home).
// - /cms/ and /cms/<dir-like-path> rewrite to /cms/index.html so the
//   Sveltia SPA can take over client-side routing on refresh.
// - /cms/<file.ext> falls through unchanged so S3 serves the asset.
// - Anything outside /cms/ and /api/ returns 404. (/api/* is handled by
//   a separate behavior whose origin is the API Gateway; this function
//   never runs for those requests.)
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

- [ ] **Step 2: Verify the file exists**

```bash
wc -l packages/infrastructure/cloudfront-cms-function.js
```

Expected: 32-35 lines (depending on exact whitespace).

---

### Task 3: Add the CMS CloudFront distribution Terraform

**Files:**
- Modify: `packages/infrastructure/cloudfront.tf` (append all new blocks at the bottom)

- [ ] **Step 1: Append the CMS resources at the bottom of `packages/infrastructure/cloudfront.tf`**

Open `packages/infrastructure/cloudfront.tf`. Leave the existing main-site blocks untouched. Append the following at the bottom:

```hcl
# ---------------------------------------------------------------------------
# CMS CloudFront distribution at cms.brigitte-le-roux.com.
# Two origins:
#   - S3 (brigitte-le-roux-website bucket) for the Sveltia SPA at /cms/*.
#   - API Gateway HTTP API for /api/* (the shared cms_trigger).
# One viewer-request CloudFront function handles SPA routing for the S3
# behavior (see cloudfront-cms-function.js).
# ---------------------------------------------------------------------------

data "aws_acm_certificate" "cms_us_east_1" {
  provider    = aws.us_east_1
  domain      = "cms.brigitte-le-roux.com"
  statuses    = ["ISSUED"]
  most_recent = true
}

# Separate OAC from the main site's. CloudFront → S3 SigV4 signing requires
# the OAC's parent distribution ARN to match the bucket policy condition;
# each distribution needs its own OAC for clean signing.
resource "aws_cloudfront_origin_access_control" "cms" {
  name                              = "${var.bucket_name}-cms-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "cms_router" {
  name    = "${var.bucket_name}-cms-router"
  runtime = "cloudfront-js-2.0"
  comment = "SPA fallback + root redirect for cms.brigitte-le-roux.com"
  publish = true
  code    = file("${path.module}/cloudfront-cms-function.js")
}

# The API Gateway hostname (no https:// prefix), extracted from the module
# output so the distribution updates if the API ID ever changes.
locals {
  cms_api_origin_hostname = trimprefix(module.cms_trigger.api_endpoint, "https://")
}

resource "aws_cloudfront_distribution" "cms" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.bucket_name}-cms"
  aliases         = ["cms.brigitte-le-roux.com"]
  price_class     = "PriceClass_100"

  # ---- S3 origin (Sveltia SPA) ----
  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-cms-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.cms.id
  }

  # ---- API Gateway origin (Lambdas behind JWT authorizer) ----
  origin {
    domain_name = local.cms_api_origin_hostname
    origin_id   = "apigw-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # ---- Default behavior: S3 + SPA-routing CF function ----
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-cms-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # AWS-managed CachingOptimized — long TTL for static assets. The CF
    # function rewrites SPA refreshes to /cms/index.html, which itself
    # benefits from this caching too. Deploys invalidate /cms/* paths so
    # freshness is enforced at deploy time.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.cms_router.arn
    }
  }

  # ---- /api/* behavior: API Gateway, no caching, forward auth ----
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "apigw-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # AWS-managed CachingDisabled — API responses are dynamic + auth-scoped.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # AWS-managed AllViewerExceptHostHeader — forwards everything (auth
    # header, query string, body, cookies) EXCEPT Host. API Gateway must
    # see its own Host header to route the request to the right API.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.cms_us_east_1.arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
}
```

- [ ] **Step 2: Format + init + validate**

```bash
terraform -chdir=packages/infrastructure fmt
terraform -chdir=packages/infrastructure init -input=false
terraform -chdir=packages/infrastructure validate
```

Expected: validate prints `Success! The configuration is valid.`

---

### Task 4: Widen the S3 bucket policy to allow the CMS distribution

**Files:**
- Modify: `packages/infrastructure/s3.tf`

- [ ] **Step 1: Update the bucket policy condition**

The current policy condition is:

```hcl
condition {
  test     = "StringEquals"
  variable = "AWS:SourceArn"
  values   = [aws_cloudfront_distribution.site.arn]
}
```

Replace it with:

```hcl
condition {
  test     = "StringEquals"
  variable = "AWS:SourceArn"
  values = [
    aws_cloudfront_distribution.site.arn,
    aws_cloudfront_distribution.cms.arn,
  ]
}
```

Use Edit:

```hcl
# old_string:
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }

# new_string:
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values = [
        aws_cloudfront_distribution.site.arn,
        aws_cloudfront_distribution.cms.arn,
      ]
    }
```

- [ ] **Step 2: Format + validate**

```bash
terraform -chdir=packages/infrastructure fmt
terraform -chdir=packages/infrastructure validate
```

Expected: validate succeeds.

---

### Task 5: Add Route 53 records for `cms.brigitte-le-roux.com`

**Files:**
- Modify: `packages/infrastructure/dns.tf`

- [ ] **Step 1: Append A + AAAA records**

Append at the bottom of `packages/infrastructure/dns.tf`:

```hcl
resource "aws_route53_record" "cms" {
  zone_id = var.hosted_zone_id
  name    = "cms.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cms.domain_name
    zone_id                = aws_cloudfront_distribution.cms.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "cms_aaaa" {
  zone_id = var.hosted_zone_id
  name    = "cms.${var.domain_name}"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.cms.domain_name
    zone_id                = aws_cloudfront_distribution.cms.hosted_zone_id
    evaluate_target_health = false
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

### Task 6: Add outputs for the CMS distribution

**Files:**
- Modify: `packages/infrastructure/outputs.tf`

- [ ] **Step 1: Append three outputs**

Append at the bottom of `packages/infrastructure/outputs.tf`:

```hcl
output "cms_url" {
  value       = "https://cms.${var.domain_name}/"
  description = "CMS entry point. Redirects to /cms/ where Sveltia is served."
}

output "cms_distribution_id" {
  value       = aws_cloudfront_distribution.cms.id
  description = "CMS CloudFront distribution ID (for cache invalidations)."
}

output "cms_distribution_domain" {
  value       = aws_cloudfront_distribution.cms.domain_name
  description = "CMS CloudFront distribution cloudfront.net domain (for debugging via raw URL)."
}
```

- [ ] **Step 2: Format + validate**

```bash
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

Expected resources to add:

- `aws_cloudfront_origin_access_control.cms`
- `aws_cloudfront_function.cms_router`
- `aws_cloudfront_distribution.cms` (the big one — takes 5-15 min)
- `aws_route53_record.cms`
- `aws_route53_record.cms_aaaa`

Expected resources to change:

- `aws_s3_bucket_policy.site` (widened condition)

Expected destroys: **0**.

If the plan shows destroys or unexpected adds/changes, STOP.

- [ ] **Step 2: Apply**

```bash
yarn infra:apply 2>&1 | tail -10
```

Expected: succeeds. CloudFront distribution creation takes 5-15 minutes; the apply blocks until the distribution status is `Deployed`. Outputs print `cms_url`, `cms_distribution_id`, `cms_distribution_domain`.

- [ ] **Step 3: Confirm `terraform plan` is now clean**

```bash
yarn infra:plan 2>&1 | tail -3
```

Expected: "No changes."

---

### Task 8: Smoke test

The distribution is live. Verify DNS resolves, root redirects to /cms/, /cms/ serves something (we'll upload a placeholder index.html), /api/git/... reaches API Gateway (returns 401 without a token), /api/media/upload-url reaches API Gateway (also 401 without a token).

- [ ] **Step 1: Upload a placeholder Sveltia index.html**

Plan 7 will overwrite this with the real Sveltia build. For now just verify routing works.

```bash
printf '<!doctype html><title>CMS placeholder</title><h1>Sveltia placeholder</h1>\n' > /tmp/p6-placeholder.html
aws s3 cp /tmp/p6-placeholder.html s3://brigitte-le-roux-website/cms/index.html \
  --content-type 'text/html; charset=utf-8'
rm -f /tmp/p6-placeholder.html
```

Expected: upload prints `upload: ...`.

- [ ] **Step 2: Wait for DNS to propagate**

```bash
for i in 1 2 3 4 5 6; do
  if dig +short cms.brigitte-le-roux.com | head -1 | grep -q '.'; then
    echo "DNS resolved on attempt $i"
    break
  fi
  echo "Attempt $i: DNS not resolved yet, sleeping 20s"
  sleep 20
done
dig +short cms.brigitte-le-roux.com
```

Expected: returns at least one IP within 2 minutes.

- [ ] **Step 3: Root redirect to /cms/**

```bash
curl -sSI https://cms.brigitte-le-roux.com/ | head -3
```

Expected: `HTTP/2 302` with `location: /cms/`.

- [ ] **Step 4: /cms/ serves the placeholder**

```bash
curl -sS https://cms.brigitte-le-roux.com/cms/ | head -3
```

Expected: the placeholder HTML (or whatever is at `s3://brigitte-le-roux-website/cms/index.html`).

- [ ] **Step 5: /cms/some/spa/route falls back to index.html**

```bash
curl -sS https://cms.brigitte-le-roux.com/cms/some/spa/route | head -3
```

Expected: same placeholder HTML — the CF function rewrote the URI to `/cms/index.html`.

- [ ] **Step 6: Path outside /cms/ and /api/ returns 404**

```bash
curl -sSI https://cms.brigitte-le-roux.com/something-random | head -3
```

Expected: `HTTP/2 404`.

- [ ] **Step 7: /api/git/* reaches API Gateway (401 without token)**

```bash
curl -sSI https://cms.brigitte-le-roux.com/api/git/repos/Maev4l/brigitte-le-roux-website/contents/packages/website/content/pages/cv/fr.md | head -3
```

Expected: `HTTP/2 401` (the JWT authorizer rejects unauthenticated requests). If you see 403 instead, that's also fine — the request reached API Gateway, just failed auth.

- [ ] **Step 8: /api/media/upload-url reaches API Gateway (401 without token)**

```bash
curl -sSI -X POST https://cms.brigitte-le-roux.com/api/media/upload-url -H 'content-type: application/json' --data '{}' | head -3
```

Expected: `HTTP/2 401`.

- [ ] **Step 9: Full auth flow through the unified subdomain (optional but recommended)**

Requires `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` exported in your shell — see preconditions on Plan 5.

```bash
APP_CLIENT_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_app_client_id)
USER_POOL_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id)

# Temp-enable USER_PASSWORD_AUTH:
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

# Hit the github-gateway through the unified subdomain:
curl -sS -X GET https://cms.brigitte-le-roux.com/api/git/repos/Maev4l/brigitte-le-roux-website \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP %{http_code}\n" | tail -5

# Restore auth flows:
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$APP_CLIENT_ID" \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --output json | rtk proxy grep ExplicitAuthFlows
```

Expected: HTTP 200 with a JSON repo description object (Octokit-style). Proves the full pipeline works via the unified subdomain: CloudFront → API Gateway → JWT authorizer → github-gateway Lambda → GitHub.

---

### Task 9: Stage, commit, push

Three commits — function source, Terraform, and (optional) plan-doc deviations folded back.

- [ ] **Step 1: Commit the CloudFront function source**

```bash
git add packages/infrastructure/cloudfront-cms-function.js

git status --short
```

Expected: lists the new function file.

```bash
git commit -m "$(cat <<'EOF'
feat(infra): add CloudFront viewer-request function for CMS routing

Handles SPA fallback and root redirect for cms.brigitte-le-roux.com:

- /                     -> 302 /cms/
- /cms or /cms/         -> /cms/index.html
- /cms/<dir-like-path>  -> /cms/index.html (SPA fallback)
- /cms/<file.ext>       -> leave alone (S3 serves)
- anything else         -> 404

/api/* never reaches this function because it's handled by a separate
behavior whose origin is API Gateway (no function association).
EOF
)"
```

- [ ] **Step 2: Commit the Terraform changes**

```bash
git add packages/infrastructure/cloudfront.tf packages/infrastructure/s3.tf packages/infrastructure/dns.tf packages/infrastructure/outputs.tf

git status --short
```

Expected: lists the four modified Terraform files (`cloudfront.tf` appended-to plus three others).

```bash
git commit -m "$(cat <<'EOF'
infra(cms): add unified CloudFront distribution at cms.brigitte-le-roux.com

One CloudFront distribution, two origins:

- S3 (brigitte-le-roux-website bucket) for the Sveltia SPA at /cms/*.
  Cache: AWS-managed CachingOptimized. Viewer-request CF function for
  SPA fallback and root redirect to /cms/.

- API Gateway HTTP API (the shared cms_trigger from Plan 4/5) for
  /api/*. Cache: AWS-managed CachingDisabled. Origin request policy:
  AllViewerExceptHostHeader so APIGW sees its own Host header.

Each distribution has its own OAC; the S3 bucket policy is widened so
both the main-site and CMS distributions can read via SigV4.

Route 53 alias records (A + AAAA) point cms.brigitte-le-roux.com at
the new distribution. ACM cert at cms.brigitte-le-roux.com lives in
us-east-1 (CloudFront requirement) and is looked up via data source.

The raw <api-id>.execute-api.eu-central-1.amazonaws.com URL stays
reachable for now (disable_execute_api_endpoint = false); a later
hardening pass will set it to true once Sveltia is wired to
/api/* same-origin.
EOF
)"
```

- [ ] **Step 3: Confirm history**

```bash
git log --oneline -5
```

Expected: two new commits on top of the previous main HEAD.

- [ ] **Step 4: Push to main**

```bash
git push origin main 2>&1 | tail -3
```

Expected: succeeds.

- [ ] **Step 5: Confirm the deploy-website workflow did NOT run**

The path filter is `packages/website/**`. Nothing under `packages/infrastructure/` matches.

```bash
gh run list --workflow=deploy-website.yml --limit 1 --json status,headSha,createdAt
```

Expected: the most recent run pre-dates this push.

---

## Self-Review

**Spec coverage** (against spec §1 + §3 references to the CMS CloudFront distribution):

| Spec requirement | Plan task |
| --- | --- |
| CMS at `cms.brigitte-le-roux.com/` | Task 5 (DNS) + Task 3 (distribution aliases) |
| Sveltia SPA hosted at `s3://brigitte-le-roux-website/cms/*` | Task 3 (S3 origin) |
| Served via a dedicated CloudFront distribution | Task 3 |
| `/api/*` routed to the HTTP API | Task 3 (`/api/*` behavior → APIGW origin) |
| Unified subdomain — same-origin so no CORS preflight | Task 3 (one distribution, two behaviors) |
| Cert at `cms.brigitte-le-roux.com` in us-east-1 (CloudFront requirement) | Task 3 (data source lookup) |
| SPA-style refresh on `/cms/foo` should serve `/cms/index.html` | Task 2 (CF function SPA fallback) |
| End-to-end auth flow through the unified subdomain | Task 8 Step 9 |

**Out of scope** (handled in later plans):

- Sveltia config + custom plugins (Plan 7 — the actual SPA content that will live at `/cms/`).
- Hardening: setting `disable_execute_api_endpoint = true` on the API Gateway. Deferred until Plan 7 exercises the same-origin path.
- WAF on the CMS distribution. Single-editor site, low value.
- CloudFront access logs. Same posture as the main-site distribution (off).
- Image optimization at build time (spec §6 follow-up).
- Schema-drift lint between Zod and Sveltia config (spec §6 follow-up).

**Placeholder scan:** no TODOs / TBDs / "implement later" / vague "handle edge cases" prose. Every code step has a concrete code block; every command step has the exact command + expected output.

**Type / contract consistency checks:**

- Origin IDs `s3-cms-origin` + `apigw-origin` used consistently in `target_origin_id` references.
- AWS-managed cache + origin-request policy IDs (`CachingOptimized`, `CachingDisabled`, `AllViewerExceptHostHeader`) are stable AWS identifiers — no version drift risk.
- `local.cms_api_origin_hostname` derived once from `module.cms_trigger.api_endpoint`; the latter is the renamed module from Plan 5 (was `github_gateway_trigger` in Plan 4).
- Bucket policy condition uses a list of ARNs — no order dependency.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-22-cms-cloudfront-distribution.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
