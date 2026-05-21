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

# HTTP API + JWT authorizer + integration + route — all bundled by the module.
# A future Plan 5 media-uploader Lambda will be added as another entry in
# the integrations map (no separate API).
module "github_gateway_trigger" {
  source = "github.com/Maev4l/terraform-modules//modules/lambda-trigger-apigw?ref=v1.7.1"

  api_name = "brigitte-le-roux-website-cms"

  # disable_execute_api_endpoint defaults to true (forces traffic through a
  # custom domain). We don't have a custom domain on the API Gateway in
  # Plan 4 — the unified cms.brigitte-le-roux.com CloudFront distribution
  # comes later — so allow the execute-api URL for now to enable smoke
  # testing.
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
  }
}

output "cms_api_endpoint" {
  value       = module.github_gateway_trigger.api_endpoint
  description = "HTTP API base URL. Routes: <endpoint>/api/git/{proxy+}."
}

output "cms_api_id" {
  value       = module.github_gateway_trigger.api_id
  description = "HTTP API ID (referenced by later plans that add routes)."
}
