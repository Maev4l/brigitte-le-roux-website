resource "aws_s3_bucket" "site" {
  bucket        = var.bucket_name
  force_destroy = true
}

# Sveltia's S3 media library hardcodes `x-amz-acl: public-read` on every
# PUT (no config knob to suppress it). The AWS-modern default is
# BucketOwnerEnforced, which rejects ANY ACL header — including
# public-read — with a 400. We switch to BucketOwnerPreferred so the
# header is accepted, while the public_access_block below
# (block_public_acls + ignore_public_acls) neutralises the ACL's
# meaning: every uploaded object is bucket-owner-owned and never
# publicly reachable via the S3 URL. Access still funnels through
# CloudFront's OAC + the bucket policy below.
resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id
  # block_public_acls is intentionally `false` so PutObject requests
  # carrying `x-amz-acl: public-read` (which Sveltia's S3 media library
  # hardcodes — see ownership_controls comment above) are not rejected
  # at the API level. ignore_public_acls=true makes those ACLs
  # functionally inert: even when stamped on objects, they grant no
  # actual public access — every read still funnels through CloudFront
  # OAC + the bucket policy in this file. Same end-state security as
  # block_public_acls=true, but compatible with Sveltia's uploader.
  block_public_acls       = false
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json
}

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "AllowCloudFrontReadFromOAC"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values = [
        aws_cloudfront_distribution.site.arn,
        aws_cloudfront_distribution.cms.arn,
      ]
    }
  }
}

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
