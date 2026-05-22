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
  # Lambda updates on every apply. The bundle is deterministic given the
  # same source.
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

# IAM policy: read the GitHub App credentials JSON from SSM (SecureString),
# decrypt via the default AWS-managed KMS key. Logs perms are added by
# the lambda-function module.
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
  description = "github-gateway Lambda: read GitHub App PEM from SSM SecureString"
  policy      = data.aws_iam_policy_document.github_gateway.json
}

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

output "cms_api_endpoint" {
  value       = module.cms_trigger.api_endpoint
  description = "HTTP API base URL. Routes: <endpoint>/api/git/{proxy+}, <endpoint>/api/media/upload-url."
}

output "cms_api_id" {
  value       = module.cms_trigger.api_id
  description = "HTTP API ID (shared between github-gateway and media-manager Lambdas)."
}
