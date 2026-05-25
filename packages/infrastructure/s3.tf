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
