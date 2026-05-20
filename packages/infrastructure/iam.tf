# ---------------------------------------------------------------------------
# GitHub Actions → AWS OIDC
# Lets GitHub Actions workflows running in this repo assume a tightly-scoped
# IAM role without long-lived AWS access keys stored in GitHub secrets.
# ---------------------------------------------------------------------------

# GitHub's OIDC provider for AWS is an account-level singleton — only one
# per (account, issuer URL) pair is allowed. We do NOT manage it from this
# project's Terraform; it's created once via the AWS console by the account
# administrator and shared across all GitHub-Actions-deployed projects in
# this account.
#
# We can't use a `data "aws_iam_openid_connect_provider"` lookup either,
# because that requires `iam:ListOpenIDConnectProviders` — a permission this
# project's day-to-day role intentionally lacks. Instead we construct the
# ARN from the (stable, documented) AWS format. STS GetCallerIdentity is
# unrestricted, so this works under least-privilege roles.
data "aws_caller_identity" "current" {}

locals {
  github_oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

# Trust policy: only allow this specific repo, any branch ref. Wildcard
# matches refs/heads/* — i.e. all branches but NOT tags (refs/tags/*) or PR
# merges (refs/pull/*). New feature branches can use this role without a
# Terraform change, while external PRs from forks (which run with the
# pull_request sub-claim) still can't assume it.
data "aws_iam_policy_document" "gha_website_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:Maev4l/brigitte-le-roux-website:ref:refs/heads/*"]
    }
  }
}

# Permissions: just what the website-deploy workflow needs.
data "aws_iam_policy_document" "gha_website_deploy" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role" "gha_website_deploy" {
  name               = "gha-website-deploy"
  assume_role_policy = data.aws_iam_policy_document.gha_website_deploy_trust.json
  description        = "Assumed by GitHub Actions deploy-website.yml via OIDC"
}

resource "aws_iam_role_policy" "gha_website_deploy" {
  name   = "gha-website-deploy"
  role   = aws_iam_role.gha_website_deploy.id
  policy = data.aws_iam_policy_document.gha_website_deploy.json
}

output "gha_website_deploy_role_arn" {
  value       = aws_iam_role.gha_website_deploy.arn
  description = "IAM role ARN to set in .github/workflows/deploy-website.yml"
}
