# ---------------------------------------------------------------------------
# Cognito User Pool for the CMS editor (Brigitte).
# Authentication entry point. The Hosted UI handles the sign-in form;
# the user is redirected back to the CMS at cms.brigitte-le-roux.com/ with
# an auth code, which Sveltia (in Plan 6) will exchange for a Cognito JWT.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "cms" {
  name = "brigitte-le-roux-website-cms"

  # Email is the username. No separate "username" attribute.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # Self-signup is disabled — administrator creates users manually.
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Welcome to brigitte-le-roux.com"
      email_message = "Your username: {username}\nTemporary password: {####}"
      sms_message   = "Username: {username}\nPassword: {####}"
    }
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # MFA: not configured at the pool level (default = OFF). Enabling it
  # requires cognito-idp:SetUserPoolMfaConfig, which the day-to-day dev
  # role intentionally lacks. The administrator can flip MFA on via the
  # AWS console later if needed (Cognito → User pools → MFA), and at that
  # point a follow-up commit can re-introduce the mfa_configuration block.

  # Account recovery is admin-only: lost passwords are reset by the
  # administrator via console, not by the user via email link. Tightens
  # the attack surface (no self-service recovery path that depends on
  # email-account control); the trade-off is the admin has to be reachable
  # when the editor forgets their password.
  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  email_configuration {
    # Default Cognito sender. Free tier covers the volume for a one-editor
    # site. If you ever hit the daily limit (50 emails) for password resets,
    # switch to SES (requires verified sender + a config set).
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Advanced security adds risk-based / adaptive authentication; costs
  # extra per MAU. OFF is appropriate for a single-editor site.
  user_pool_add_ons {
    advanced_security_mode = "OFF"
  }
}

# App client used by Sveltia (single-page app in the browser). Public client
# (no client secret). OAuth Authorization Code flow with PKCE.
resource "aws_cognito_user_pool_client" "cms" {
  name         = "brigitte-le-roux-website-cms-spa"
  user_pool_id = aws_cognito_user_pool.cms.id

  # No client secret — required for public SPA clients.
  generate_secret = false

  # OAuth Auth Code + PKCE.
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]

  # After login the Hosted UI redirects to the CMS at cms.brigitte-le-roux.com.
  # That subdomain doesn't have a DNS record yet (it will when the CloudFront
  # distribution for the CMS lands in a later plan). The redirect URL is
  # registered now so we don't need to update it later.
  callback_urls = ["https://cms.brigitte-le-roux.com/"]
  logout_urls   = ["https://cms.brigitte-le-roux.com/"]

  # Supported identity providers: just COGNITO (the User Pool itself).
  supported_identity_providers = ["COGNITO"]

  # Token validity. Access + id tokens 60 min (must refresh; Sveltia's
  # plugin handles this). Refresh token valid 1 year — the editor stays
  # logged in for up to a year unless they explicitly sign out or clear
  # storage.
  refresh_token_validity = 365
  access_token_validity  = 60
  id_token_validity      = 60
  token_validity_units {
    refresh_token = "days"
    access_token  = "minutes"
    id_token      = "minutes"
  }

  # Prevent user enumeration (Cognito returns generic "user does not exist
  # or incorrect password" instead of differentiating).
  prevent_user_existence_errors = "ENABLED"

  # Auth flows enabled: ALLOW_USER_SRP_AUTH (standard SRP login from the
  # Hosted UI) and ALLOW_REFRESH_TOKEN_AUTH (refresh flow used silently by
  # the SPA when the access token expires).
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

# Cognito-managed Hosted UI domain. Uses the prefix subdomain pattern at
# <prefix>.auth.<region>.amazoncognito.com — free, no ACM cert needed.
# The end-user-facing URL after login is cms.brigitte-le-roux.com, served
# by the CloudFront distribution that lands in a later plan; the Hosted UI
# only appears during the login moment.
resource "aws_cognito_user_pool_domain" "cms" {
  domain       = "brigitte-le-roux-website-cms"
  user_pool_id = aws_cognito_user_pool.cms.id
}

output "cognito_user_pool_id" {
  value       = aws_cognito_user_pool.cms.id
  description = "Cognito User Pool ID — referenced by the API Gateway JWT authorizer"
}

output "cognito_app_client_id" {
  value       = aws_cognito_user_pool_client.cms.id
  description = "App Client ID — used by Sveltia (Plan 6) to construct the Hosted UI URL"
}

output "cognito_hosted_ui_url" {
  value       = "https://${aws_cognito_user_pool_domain.cms.domain}.auth.${var.aws_region}.amazoncognito.com"
  description = "Hosted UI base URL. Login URL: https://<this>/login?client_id=<app_client_id>&response_type=code&scope=openid+email&redirect_uri=https%3A%2F%2Fcms.brigitte-le-roux.com%2F"
}

output "cognito_issuer" {
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.cms.id}"
  description = "JWT issuer URL — referenced by the API Gateway JWT authorizer"
}
