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
    AWS_LAMBDA_EXEC_WRAPPER = "/opt/bootstrap"
    # The SSM SecureString containing { access_key_id, secret_access_key }
    MEDIA_MANAGER_CREDENTIALS_PARAM = "brigitte-le-roux-website.sveltia-media-manager-credentials"
    # Hono binds to this port; LWA dials it on the same loopback.
    PORT = "8080"
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
        "GET /api/media/s3-credentials",
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
