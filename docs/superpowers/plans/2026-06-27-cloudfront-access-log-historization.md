# CloudFront Access-Log Historization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Parquet access logs from both CloudFront distributions (`site`, `cms`) into one shared S3 bucket, separated by prefix, with 90-day auto-prune — observe-only, infra-only.

**Architecture:** Two parallel CloudWatch "standard logging v2" delivery pipelines (one per distribution) write Parquet to `raw/site/` and `raw/cms/` in a dedicated log bucket. The bucket + its delivery-service write policy live in `s3.tf`; the six delivery resources live in a new `logs.tf`. All delivery resources run in `us-east-1` (CloudFront Delivery API requirement); the bucket is in `eu-central-1`.

**Tech Stack:** Terraform (AWS provider `~> 6.0`), HCL only. No application/Astro/CMS-frontend code.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-27-cloudfront-access-log-historization-design.md`.
- **Scope:** `packages/infrastructure/` only. No Lambda/Astro/frontend changes.
- **Region split:** Bucket + S3 resources use the **default** provider (eu-central-1). All `aws_cloudwatch_log_delivery_*` resources use `provider = aws.us_east_1` (alias already declared in `main.tf`).
- **Account id:** reuse `data.aws_caller_identity.current` (already declared in `iam.tf` — do NOT re-declare it).
- **Bucket name:** `${var.bucket_name}-cloudfront-logs-${data.aws_caller_identity.current.account_id}` → `brigitte-le-roux-website-cloudfront-logs-<account-id>`.
- **`force_destroy = true`** on the bucket (repo convention).
- **Record fields:** exactly the 14-field set (see Task 2 `locals`). Exact field names are validated at apply time — do not alter casing or the `cs(...)` parenthesized forms.
- **Commits:** the user's global rule is **never commit automatically**. Each task's commit step is written out but MUST be confirmed with the user before running.
- **Validate command:** `terraform -chdir=packages/infrastructure validate` (provider already initialized — `.terraform/` exists). Format: `terraform -chdir=packages/infrastructure fmt`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/infrastructure/s3.tf` | **Modify** — append the log bucket + public-access block + encryption + lifecycle + bucket policy (delivery-service write grant). |
| `packages/infrastructure/logs.tf` | **Create** — `locals` field set + 6 delivery resources (2× source/destination/delivery). |
| `packages/infrastructure/outputs.tf` | **Modify** — output the log bucket name. |
| `CLAUDE.md` | **Modify** — add a "CloudFront access logs" section. |

---

## Task 1: Log bucket + delivery-write policy (`s3.tf`)

**Files:**
- Modify: `packages/infrastructure/s3.tf` (append at end)

**Interfaces:**
- Consumes: `var.bucket_name`, `data.aws_caller_identity.current.account_id` (from `iam.tf`).
- Produces:
  - `aws_s3_bucket.cloudfront_logs` (`.id`, `.arn`) — consumed by Task 2 (delivery destinations) and Task 3 (output).
  - `aws_s3_bucket_policy.cloudfront_logs` — Task 2 deliveries `depends_on` this.

- [ ] **Step 1: Append the bucket and supporting resources to `s3.tf`**

```hcl

# ---------------------------------------------------------------------------
# CloudFront access-log historization (observe-only).
#
# One dedicated bucket receives Parquet access logs from BOTH CloudFront
# distributions, separated by prefix: site → raw/site/ , cms → raw/cms/.
# A 90-day lifecycle rule prunes the whole bucket. The delivery wiring
# (CloudWatch Logs "standard logging v2") lives in logs.tf; the bucket and
# its policy live here by repo convention.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "cloudfront_logs" {
  bucket        = "${var.bucket_name}-cloudfront-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

# Pure log sink — fully private. No Sveltia `public-read` ACL accommodation
# (unlike the content bucket); all four flags on.
resource "aws_s3_bucket_public_access_block" "cloudfront_logs" {
  bucket                  = aws_s3_bucket.cloudfront_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3. v2 delivery to S3 supports AES256; SSE-KMS would need extra
# key-policy grants for the delivery service (out of scope).
resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Whole-bucket 90-day expiry — everything here is logs under raw/.
resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id

  rule {
    id     = "expire-all-after-90-days"
    status = "Enabled"

    # Empty filter = whole bucket (no prefix scoping).
    filter {}

    expiration {
      days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
}

resource "aws_s3_bucket_policy" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  policy = data.aws_iam_policy_document.cloudfront_logs.json
}

# AWS-documented AWSLogsDeliveryWrite grant for the log-delivery service.
# WHY each condition matters: if SourceAccount / SourceArn / x-amz-acl are
# missing or wrong, OR the Resource doesn't cover where logs land, delivery
# fails SILENTLY with AccessDenied — no logs, nothing surfaced on the
# distribution. Whole-bucket Resource sidesteps the prefix-mismatch trap.
# The delivery-source:* wildcard covers both pipelines (site + cms).
data "aws_iam_policy_document" "cloudfront_logs" {
  statement {
    sid       = "AWSLogsDeliveryWrite"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cloudfront_logs.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"]
    }
  }
}
```

- [ ] **Step 2: Format**

Run: `terraform -chdir=packages/infrastructure fmt`
Expected: prints `s3.tf` (reformatted) or nothing if already canonical; exit 0.

- [ ] **Step 3: Validate**

Run: `terraform -chdir=packages/infrastructure validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit** (confirm with user first — see Global Constraints)

```bash
git add packages/infrastructure/s3.tf
git commit -m "infra(logs): add CloudFront access-log S3 bucket + delivery-write policy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Delivery pipelines (`logs.tf`)

**Files:**
- Create: `packages/infrastructure/logs.tf`

**Interfaces:**
- Consumes: `aws_s3_bucket.cloudfront_logs.arn`, `aws_s3_bucket_policy.cloudfront_logs` (Task 1); `aws_cloudfront_distribution.site.arn`, `aws_cloudfront_distribution.cms.arn` (`cloudfront.tf`); `var.bucket_name`; `aws.us_east_1` provider (`main.tf`).
- Produces: 6 delivery resources. Nothing downstream consumes them.

**Schema note (do not "correct" to the spec table):** `aws_cloudwatch_log_delivery_destination` takes a `delivery_destination_configuration { destination_resource_arn = ... }` block; its `delivery_destination_type` is a **computed/read-only** attribute derived from the ARN, NOT an input — do not set it. The S3 path prefix goes inside `destination_resource_arn` (`.../raw/site`), which both targets the prefix and suppresses CloudFront's default `AWSLogs/...` path.

- [ ] **Step 1: Create `logs.tf`**

```hcl
# ---------------------------------------------------------------------------
# CloudFront standard logging v2 → S3 (Parquet), observe-only.
#
# The CloudWatch Logs "delivery" subsystem is the generic pipe AWS uses to
# route logs from many sources to S3; CloudFront's docs call this same
# feature "standard logging v2". Nothing is stored in CloudWatch — logs land
# as Parquet in the bucket defined in s3.tf.
#
# The Delivery API for CloudFront MUST be called in us-east-1 even though the
# destination bucket is in eu-central-1 (cross-region delivery is allowed) —
# hence provider = aws.us_east_1 on every resource here.
#
# Two parallel pipelines (one per distribution) write to distinct prefixes:
#   site → raw/site/ , cms → raw/cms/
# ---------------------------------------------------------------------------

locals {
  # 14-field record set. EXACT names are validated at apply time:
  # date/time (there is no single "timestamp" standard field); cs(Host) and
  # cs(User-Agent) use the W3C parenthesized form; c-country + asn give native
  # geo / network-owner per row (strong bot/scanner signal).
  cloudfront_log_fields = [
    "date", "time", "c-ip", "c-country", "asn",
    "cs-method", "cs-protocol", "cs(Host)", "cs-uri-stem", "cs-uri-query",
    "sc-status", "x-edge-result-type", "x-edge-location", "cs(User-Agent)",
  ]
}

# ===== Site distribution (brigitte-le-roux.com) → raw/site/ =====
resource "aws_cloudwatch_log_delivery_source" "site" {
  provider     = aws.us_east_1
  name         = "${var.bucket_name}-site-cloudfront"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudwatch_log_delivery_destination" "site" {
  provider      = aws.us_east_1
  name          = "${var.bucket_name}-site-cloudfront-s3"
  output_format = "parquet"

  delivery_destination_configuration {
    destination_resource_arn = "${aws_s3_bucket.cloudfront_logs.arn}/raw/site"
  }
}

resource "aws_cloudwatch_log_delivery" "site" {
  provider                 = aws.us_east_1
  delivery_source_name     = aws_cloudwatch_log_delivery_source.site.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.site.arn
  record_fields            = local.cloudfront_log_fields

  # The bucket policy must exist before delivery starts, else writes fail
  # silently with AccessDenied (the policy is not referenced by ARN, so the
  # dependency is not otherwise inferred).
  depends_on = [aws_s3_bucket_policy.cloudfront_logs]
}

# ===== CMS distribution (cms.brigitte-le-roux.com) → raw/cms/ =====
resource "aws_cloudwatch_log_delivery_source" "cms" {
  provider     = aws.us_east_1
  name         = "${var.bucket_name}-cms-cloudfront"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.cms.arn
}

resource "aws_cloudwatch_log_delivery_destination" "cms" {
  provider      = aws.us_east_1
  name          = "${var.bucket_name}-cms-cloudfront-s3"
  output_format = "parquet"

  delivery_destination_configuration {
    destination_resource_arn = "${aws_s3_bucket.cloudfront_logs.arn}/raw/cms"
  }
}

resource "aws_cloudwatch_log_delivery" "cms" {
  provider                 = aws.us_east_1
  delivery_source_name     = aws_cloudwatch_log_delivery_source.cms.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cms.arn
  record_fields            = local.cloudfront_log_fields

  depends_on = [aws_s3_bucket_policy.cloudfront_logs]
}
```

- [ ] **Step 2: Format**

Run: `terraform -chdir=packages/infrastructure fmt`
Expected: prints `logs.tf` or nothing; exit 0.

- [ ] **Step 3: Validate**

Run: `terraform -chdir=packages/infrastructure validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit** (confirm with user first)

```bash
git add packages/infrastructure/logs.tf
git commit -m "infra(logs): wire CloudFront v2 log delivery for site + cms to S3

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Output + documentation

**Files:**
- Modify: `packages/infrastructure/outputs.tf` (append)
- Modify: `CLAUDE.md` (add section)

**Interfaces:**
- Consumes: `aws_s3_bucket.cloudfront_logs.id` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Append the output to `outputs.tf`**

```hcl

output "cloudfront_logs_bucket_name" {
  value       = aws_s3_bucket.cloudfront_logs.id
  description = "S3 bucket holding CloudFront access logs (Parquet under raw/site/, raw/cms/)."
}
```

- [ ] **Step 2: Add a "CloudFront access logs" section to `CLAUDE.md`**

Insert this section immediately **before** the `## Build & deploy` heading:

```markdown
## CloudFront access logs

Both CloudFront distributions emit standard-logging-**v2** access logs as
Parquet into one dedicated bucket, `brigitte-le-roux-website-cloudfront-logs-<account-id>`,
separated by prefix:

- `site` distribution (`brigitte-le-roux.com`)     → `raw/site/`
- `cms` distribution (`cms.brigitte-le-roux.com`) → `raw/cms/`

Observe-only — purpose is security/abuse investigation and light analytics
(client IP, country, ASN, path, status, UA — the 14-field set). No WAF/blocking,
no query layer, no dashboard (all deliberately out of scope; the Parquet stays
queryable later if wanted). A whole-bucket lifecycle rule auto-deletes objects
after 90 days.

Terraform: the bucket + its delivery-write policy live in
`packages/infrastructure/s3.tf`; the six delivery resources (2× source /
destination / delivery, one pipeline per distribution) live in
`packages/infrastructure/logs.tf`. All delivery resources run in `us-east-1`
(CloudFront Delivery API requirement) even though the bucket is in
`eu-central-1`. Record fields are defined once in the `cloudfront_log_fields`
local — adding a field is a one-line change there.

**Gotcha:** delivery fails *silently* (AccessDenied, nothing surfaced on the
distribution) if the bucket policy's `aws:SourceAccount` / `aws:SourceArn` /
`s3:x-amz-acl` conditions or `Resource` are wrong. After any change, verify
Parquet objects actually appear under both prefixes within ~15 min of traffic.
```

- [ ] **Step 3: Format + validate (catches output typos)**

Run: `terraform -chdir=packages/infrastructure fmt && terraform -chdir=packages/infrastructure validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit** (confirm with user first)

```bash
git add packages/infrastructure/outputs.tf CLAUDE.md
git commit -m "infra(logs): output log bucket name + document CloudFront access logs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Plan, apply & verify delivery

This task has no code — it provisions and confirms logs actually land. Requires AWS credentials with access to the Terraform state and the target account.

- [ ] **Step 1: Review the plan**

Run: `yarn infra:plan` (i.e. `terraform -chdir=packages/infrastructure plan`)
Expected: a **create** plan for exactly these new resources and nothing destroyed —
- `aws_s3_bucket.cloudfront_logs` + its public-access block, encryption, lifecycle, policy (5 S3 resources)
- 6 `aws_cloudwatch_log_delivery_*` resources (all showing `us-east-1`)

Confirm the bucket name resolves to `brigitte-le-roux-website-cloudfront-logs-<account-id>` and the two destination ARNs end in `/raw/site` and `/raw/cms`.

- [ ] **Step 2: Apply** (confirm with user first)

Run: `yarn infra:apply`
Expected: `Apply complete!` with the new resources created; `cloudfront_logs_bucket_name` shown in outputs.

- [ ] **Step 3: Generate traffic on both hosts**

```bash
curl -sS -o /dev/null https://brigitte-le-roux.com/
curl -sS -o /dev/null https://cms.brigitte-le-roux.com/
```

- [ ] **Step 4: Confirm Parquet objects appear (wait ~15 min — delivery is batched)**

```bash
aws s3 ls s3://brigitte-le-roux-website-cloudfront-logs-<account-id>/raw/site/ --recursive
aws s3 ls s3://brigitte-le-roux-website-cloudfront-logs-<account-id>/raw/cms/  --recursive
```
Expected: at least one `*.parquet` object under each prefix. **If empty after ~15 min**, the bucket-policy conditions/`Resource` are the first suspect (silent AccessDenied).

- [ ] **Step 5: Spot-check a row has a populated `c-ip` / `c-country`**

Download one Parquet file and inspect (e.g. with `duckdb`, `pandas`, or `parquet-tools`):
```bash
aws s3 cp s3://brigitte-le-roux-website-cloudfront-logs-<account-id>/raw/site/<file>.parquet /tmp/sample.parquet
duckdb -c "SELECT \"c-ip\", \"c-country\", \"cs(Host)\", \"sc-status\" FROM '/tmp/sample.parquet' LIMIT 5;"
```
Expected: rows with a non-empty `c-ip` and a country code (e.g. `FR`).

---

## Self-Review

**Spec coverage:**
- Goal (both distributions, 90-day S3 Parquet, observe-only) → Tasks 1–4. ✓
- One shared bucket, `raw/site/` + `raw/cms/` prefixes → Task 1 (bucket), Task 2 (destination ARNs). ✓
- SSE-S3, public-access block, whole-bucket 90-day lifecycle, delivery-write policy with all 3 conditions → Task 1. ✓
- 6 delivery resources, all us-east-1, no `s3_delivery_configuration`, 14-field set → Task 2. ✓
- Output bucket name + CLAUDE.md docs → Task 3. ✓
- Verification (plan/apply/confirm Parquet/spot-check) → Task 4. ✓

**Placeholder scan:** `<account-id>` and `<file>` in Task 4 are runtime values (the account id is injected by Terraform via `data.aws_caller_identity.current`; the filename is AWS-generated and unknowable until objects land) — intentional, not plan gaps. No TODO/TBD/"handle edge cases". ✓

**Type/name consistency:** `aws_s3_bucket.cloudfront_logs` / `aws_s3_bucket_policy.cloudfront_logs` / `local.cloudfront_log_fields` referenced identically across Tasks 1–3. Resource names `*.site` / `*.cms` consistent. Schema note in Task 2 prevents the `delivery_destination_type` mis-set the spec table implies. ✓
