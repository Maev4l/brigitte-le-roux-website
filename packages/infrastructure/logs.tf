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
# Two parallel pipelines (one per distribution) write to distinct prefixes,
# each Hive-date-partitioned underneath:
#   site → raw/site/year=YYYY/month=MM/day=DD/
#   cms  → raw/cms/year=YYYY/month=MM/day=DD/
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

  # Hive-style date partitioning UNDER the raw/site prefix => objects land at
  # raw/site/year=YYYY/month=MM/day=DD/. enable_hive_compatible_path MUST be
  # true: only then does AWS allow the key=value layout, and it auto-expands the
  # bare {yyyy}/{MM}/{dd} placeholders into year=/month=/day= (writing
  # "year={yyyy}" literally is rejected with "Provided suffixPath is invalid"
  # while the flag is off).
  s3_delivery_configuration {
    suffix_path                 = "{yyyy}/{MM}/{dd}"
    enable_hive_compatible_path = true
  }

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

  # Hive-style date partitioning UNDER the raw/cms prefix => objects land at
  # raw/cms/year=YYYY/month=MM/day=DD/. See the site delivery above for why
  # enable_hive_compatible_path must be true.
  s3_delivery_configuration {
    suffix_path                 = "{yyyy}/{MM}/{dd}"
    enable_hive_compatible_path = true
  }

  depends_on = [aws_s3_bucket_policy.cloudfront_logs]
}
