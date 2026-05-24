# Pre-existing ACM certificate for brigitte-le-roux.com (us-east-1, CloudFront requirement).
data "aws_acm_certificate" "site_us_east_1" {
  provider    = aws.us_east_1
  domain      = var.domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.bucket_name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "rewrite_index" {
  name    = "${var.bucket_name}-rewrite-index"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite directory URIs to /index.html"
  publish = true
  code    = file("${path.module}/cloudfront-site-function.js")
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = var.bucket_name
  aliases             = [var.domain_name]
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # AWS managed: CachingOptimized — deploys invalidate /* so freshness is guaranteed.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite_index.arn
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.site_us_east_1.arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
}

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

# Rewrites the Authorization header from `token <jwt>` (the format
# Sveltia's GitHub backend uses by default) to `Bearer <jwt>` (the format
# API Gateway's Cognito JWT authorizer requires). Without this, every
# request from Sveltia would be rejected with 401 before reaching the
# github-gateway Lambda. Attached to the /api/* behavior only.
resource "aws_cloudfront_function" "cms_api_auth_rewriter" {
  name    = "${var.bucket_name}-cms-api-auth-rewriter"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite Authorization: token -> Bearer for the /api/* path"
  publish = true
  code    = file("${path.module}/cloudfront-api-auth-function.js")
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

    # Rewrites `Authorization: token <jwt>` (Sveltia's default for the
    # GitHub backend) -> `Authorization: Bearer <jwt>` so API Gateway's
    # JWT authorizer recognises it.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.cms_api_auth_rewriter.arn
    }
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
