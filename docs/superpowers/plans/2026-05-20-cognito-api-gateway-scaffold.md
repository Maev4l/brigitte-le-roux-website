# Cognito + API Gateway Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the authentication + API entry point for the CMS:
- A Cognito User Pool where the editor (Brigitte) will eventually authenticate.
- A Hosted UI for the login flow (sign-in page rendered by AWS, branded with our App Client).
- An HTTP API Gateway with a JWT authorizer wired to the User Pool — ready to receive Lambda routes in Plan 4.
- A single manually-created test user, used to validate the Hosted UI login flow end-to-end.

No Lambdas, no routes, no CMS code yet — that's Plan 4+.

**Architecture:** Pure Terraform addition under `packages/infrastructure/`. Two new files: `cognito.tf` and `api-gateway.tf`. The target end state for the CMS is a **single custom subdomain** `cms.brigitte-le-roux.com` served by a CloudFront distribution with two origins:

```
cms.brigitte-le-roux.com  (CloudFront, one cert)
├── /        →  S3 origin (Sveltia static SPA, from packages/website/public/admin/ → s3://bucket/admin/)
└── /api/*   →  API Gateway origin (Lambda routes, no caching)
```

That unified architecture means same-origin for everything Brigitte does (no CORS friction). The Cognito callback URL therefore points at `https://cms.brigitte-le-roux.com/`.

This plan stops short of building the CloudFront distribution itself — that lands in a later plan once the Lambdas + Sveltia config exist to serve through it. ACM certs for `cms.brigitte-le-roux.com` already exist (admin-created):
- us-east-1: `arn:aws:acm:us-east-1:671123374425:certificate/fba97e58-df50-4fc7-ab77-5ee7da02e185` (for the future CloudFront)
- eu-central-1: `arn:aws:acm:eu-central-1:671123374425:certificate/fef35ea2-23c9-4dc3-b33d-d1590a294045` (kept for potential API Gateway custom domain — likely unused given the same-origin CloudFront approach)

Cognito's Hosted UI itself uses the AWS-managed prefix domain `<prefix>.auth.<region>.amazoncognito.com` — no custom domain on it (would require a separate ACM cert + extra config; unnecessary since users go straight to `cms.brigitte-le-roux.com` after login).

**Tech Stack:** Terraform, AWS Cognito User Pools + Hosted UI, AWS API Gateway v2 (HTTP API), JWT authorizer.

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §3 (Cognito User Pool, API Gateway HTTP API).

---

## Preconditions

- On branch `main` (we now develop directly on main since the CI/CD workflow is gated by path filter — infra-only changes don't trigger the website deploy). Workflow alternative: create a feature branch if you prefer PR-based review for infra changes.
- Working tree clean: `git status --porcelain` empty.
- `yarn infra:plan` succeeds and reports "No changes" — proves Terraform state is healthy and the previous plan's IAM resources are in place.
- AWS dev role has the following permissions (test in Task 1):
  - `cognito-idp:Create/Describe/UpdateUserPool*`, `cognito-idp:*UserPoolClient`, `cognito-idp:*UserPoolDomain`
  - `apigateway:*` on the HTTP API resources

If any check in Task 1 fails, the rest of the plan is BLOCKED until the dev role is granted the missing permissions OR the resources are created under an admin role (Option A from Plan 2's IAM resolution).

## Approach notes

- **One commit at the end** of agent work — same pattern as previous plans.
- **No push during execution.** The administrator pushes after smoke-test passes.
- **Pushing to `main` does NOT trigger the website-deploy workflow** because the path filter (`packages/website/**`) doesn't match infrastructure-only changes. Safe to push.
- **Deferred from this plan**, captured as a follow-up: custom domains for both Cognito (`auth.brigitte-le-roux.com`) and API Gateway (`cms-api.brigitte-le-roux.com`). Adds ACM certs + Route 53 records. Maybe ~30 lines of HCL.
- **One manual step is required at Task 5**: the administrator (you) creates a test user in the Cognito User Pool via console OR via `aws cognito-idp admin-create-user`. Cognito's free tier covers the test user; no cost.

---

### Task 1: Verify preconditions

- [ ] **Step 1: Confirm branch + clean tree**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: `main`, then empty.

- [ ] **Step 2: Confirm Terraform state is healthy**

Run: `yarn infra:plan 2>&1 | tail -5`

Expected: "No changes. Your infrastructure matches the configuration."

If pending changes appear, resolve before proceeding.

- [ ] **Step 3: Confirm dev role has Cognito + API Gateway create permissions**

Run two dry-probe commands (NOT actually creating resources — these just exercise the permission paths):
```bash
aws cognito-idp list-user-pools --max-results 1 2>&1 | head -3
aws apigatewayv2 get-apis --max-results 1 2>&1 | head -3
```

Expected: both return successfully (`UserPools: [...]` and `Items: [...]`, possibly empty arrays). If either fails with `AccessDenied`, the dev role lacks the permission — stop and resolve before proceeding.

---

### Task 2: Write `packages/infrastructure/cognito.tf`

**Files:**
- Create: `packages/infrastructure/cognito.tf`

- [ ] **Step 1: Create the file**

Write `packages/infrastructure/cognito.tf` with this exact content:

```hcl
# ---------------------------------------------------------------------------
# Cognito User Pool for the CMS editor (Brigitte).
# Authentication entry point. The Hosted UI handles the sign-in form;
# the user is redirected back to the CMS at /admin/ with an auth code,
# which Sveltia (in Plan 6) will exchange for a Cognito JWT.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "cms" {
  name = "brigitte-le-roux-website-cms"

  # Email is the username. No separate "username" attribute.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Self-signup is disabled — administrator creates users manually.
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Bienvenue sur brigitte-le-roux.com"
      email_message = "Votre identifiant : {username}\nMot de passe temporaire : {####}"
      sms_message   = "Identifiant : {username}\nMot de passe : {####}"
    }
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # MFA optional at launch. Brigitte can opt in from her account settings.
  # Tighten to ON once she's comfortable with the login flow.
  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  email_configuration {
    # Default Cognito sender. Free tier covers the volume for a one-editor
    # site. If you ever hit the daily limit (50 emails) for password resets,
    # switch to SES (requires verified sender + a config set).
    email_sending_account = "COGNITO_DEFAULT"
  }

  # User pool sees a brand-new schema by default. We're not adding custom
  # attributes — email + standard claims are enough.
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

  # Token validity. Access tokens 1 h (must refresh; Sveltia's plugin
  # handles this). Refresh tokens 30 d (Brigitte stays logged in for ~30 d
  # unless she clears storage).
  refresh_token_validity = 30
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
# A custom subdomain (auth.brigitte-le-roux.com) is a follow-up plan.
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
  description = "Hosted UI base URL. Login URL: https://<this>/login?client_id=<app_client_id>&response_type=code&scope=openid+email&redirect_uri=https://brigitte-le-roux.com/admin/"
}

output "cognito_issuer" {
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.cms.id}"
  description = "JWT issuer URL — referenced by the API Gateway JWT authorizer"
}
```

- [ ] **Step 2: Format and validate**

Run:
```bash
terraform -chdir=packages/infrastructure fmt cognito.tf
terraform -chdir=packages/infrastructure validate
```

Expected: `validate` reports "Success! The configuration is valid."

---

### Task 3: Write `packages/infrastructure/api-gateway.tf`

**Files:**
- Create: `packages/infrastructure/api-gateway.tf`

- [ ] **Step 1: Create the file**

Write `packages/infrastructure/api-gateway.tf` with this exact content:

```hcl
# ---------------------------------------------------------------------------
# API Gateway v2 (HTTP API) for the CMS backend.
# All editor requests funnel through here. CORS-locked to brigitte-le-roux.com.
# Cognito JWT authorizer wired in; routes are added in Plan 4 when the
# git-gateway + media-uploader Lambdas land.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "cms" {
  name          = "brigitte-le-roux-website-cms"
  protocol_type = "HTTP"
  description   = "Editor backend: routes Sveltia calls to the git-gateway and media-uploader Lambdas"

  # CORS is configured defensively even though the end-state is same-origin
  # (Sveltia and the API both served from cms.brigitte-le-roux.com via
  # CloudFront). Same-origin requests skip CORS, so these headers won't
  # normally fire — but they make the API safely usable from the same
  # subdomain if anything ever calls the execute-api URL directly during
  # development.
  cors_configuration {
    allow_origins     = ["https://cms.brigitte-le-roux.com"]
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"]
    allow_headers     = ["Authorization", "Content-Type"]
    expose_headers    = ["ETag"]
    max_age           = 3600
    allow_credentials = false
  }
}

# Default stage with auto-deploy. Means any route/integration change in
# Terraform takes effect on `terraform apply` without an explicit deployment
# step.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.cms.id
  name        = "$default"
  auto_deploy = true
}

# JWT authorizer: validates the Bearer token presented by Sveltia against
# the Cognito User Pool. Routes that reference this authorizer require a
# valid token; routes without it accept anonymous traffic (Plan 4 won't
# expose any anonymous routes).
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.cms.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.cms.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.cms.id}"
  }
}

output "cms_api_endpoint" {
  value       = aws_apigatewayv2_api.cms.api_endpoint
  description = "Default HTTPS endpoint for the CMS API (no custom domain yet)"
}

output "cms_api_id" {
  value       = aws_apigatewayv2_api.cms.id
  description = "API ID — referenced by route+integration resources in Plan 4"
}

output "cms_api_authorizer_id" {
  value       = aws_apigatewayv2_authorizer.cognito.id
  description = "Cognito JWT authorizer ID — attached to routes by Plan 4"
}
```

- [ ] **Step 2: Format and validate**

Run:
```bash
terraform -chdir=packages/infrastructure fmt api-gateway.tf
terraform -chdir=packages/infrastructure validate
```

Expected: `validate` succeeds.

---

### Task 4: Terraform plan + apply

- [ ] **Step 1: Plan**

Run: `yarn infra:plan 2>&1 | tail -40`

Expected: plan shows these resources to add:
- `aws_cognito_user_pool.cms`
- `aws_cognito_user_pool_client.cms`
- `aws_cognito_user_pool_domain.cms`
- `aws_apigatewayv2_api.cms`
- `aws_apigatewayv2_stage.default`
- `aws_apigatewayv2_authorizer.cognito`

Plan summary: `Plan: 6 to add, 0 to change, 0 to destroy.`

Plus four new outputs added:
- `cognito_user_pool_id` (known after apply)
- `cognito_app_client_id` (known after apply)
- `cognito_hosted_ui_url` (known after apply)
- `cognito_issuer` (known after apply)
- `cms_api_endpoint` (known after apply)
- `cms_api_id` (known after apply)
- `cms_api_authorizer_id` (known after apply)

If any **existing** resource appears in the change set, stop — investigate before applying.

- [ ] **Step 2: Apply**

Run: `yarn infra:apply 2>&1 | tail -25`

Expected: succeeds. Output prints the new values:
```
cognito_user_pool_id = "eu-central-1_AbCdEfGhI"
cognito_app_client_id = "1234567890abcdefghij"
cognito_hosted_ui_url = "https://brigitte-le-roux-website-cms.auth.eu-central-1.amazoncognito.com"
cognito_issuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_AbCdEfGhI"
cms_api_endpoint = "https://abcdef1234.execute-api.eu-central-1.amazonaws.com"
cms_api_id = "abcdef1234"
cms_api_authorizer_id = "..."
```

Record these — they're needed for Task 5 (test user creation) and Task 6 (smoke test). Subsequent plans (4+) will reference them via Terraform too, so they don't need to be hardcoded elsewhere yet.

---

### Task 5: Create a test Cognito user

This is the one manual bootstrap step. Cognito's `allow_admin_create_user_only = true` means new users can only be created by an admin.

- [ ] **Step 1: Create the user via CLI**

Replace `<admin-email>` with an email address you actually receive at (you'll get the temporary password there).

```bash
USER_POOL_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_user_pool_id)
TEST_EMAIL="<admin-email>"

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$TEST_EMAIL" \
  --user-attributes Name=email,Value="$TEST_EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Expected: returns a JSON blob with `User.UserStatus: "FORCE_CHANGE_PASSWORD"`. Cognito sends an email to `<admin-email>` with the username (= email) and a temporary password.

If your dev role lacks `cognito-idp:AdminCreateUser`, fall back to the AWS Console: Cognito → User pools → brigitte-le-roux-website-cms → Users → Create user (UI).

- [ ] **Step 2: Receive the email + note the temporary password**

Check inbox for the welcome email. Subject is `Bienvenue sur brigitte-le-roux.com`. The body contains the username + a 6-digit temp password (Cognito-generated).

If the email doesn't arrive within ~2 min: check spam; check the Cognito console's "Users" view to confirm the user exists; resend via console if needed.

---

### Task 6: Smoke-test the Hosted UI login flow

Verify the user can log in via Cognito's Hosted UI and gets redirected back to `https://cms.brigitte-le-roux.com/` with an auth code.

⚠️ **Important caveat**: `cms.brigitte-le-roux.com` has no DNS record yet — the CloudFront distribution for the CMS lands in a later plan. The browser **will** show a DNS resolution failure after the redirect. **The success signal is that the URL bar after the DNS error contains `?code=<value>` and `state=<value>`** — proving Cognito issued the authorization code, signed it, and tried to redirect to the configured callback. End-to-end OAuth completion (the SPA receiving and exchanging the code) is verified in the later plan that adds the CMS CloudFront + Sveltia.

- [ ] **Step 1: Construct the login URL**

```bash
APP_CLIENT_ID=$(terraform -chdir=packages/infrastructure output -raw cognito_app_client_id)
HOSTED_UI=$(terraform -chdir=packages/infrastructure output -raw cognito_hosted_ui_url)

LOGIN_URL="${HOSTED_UI}/login?client_id=${APP_CLIENT_ID}&response_type=code&scope=openid+email&redirect_uri=https%3A%2F%2Fcms.brigitte-le-roux.com%2F"
echo "$LOGIN_URL"
```

Expected: a URL that looks like
`https://brigitte-le-roux-website-cms.auth.eu-central-1.amazoncognito.com/login?client_id=...&response_type=code&scope=openid+email&redirect_uri=https%3A%2F%2Fcms.brigitte-le-roux.com%2F`

- [ ] **Step 2: Open the URL in a browser**

A Cognito-branded sign-in form appears.

- [ ] **Step 3: Sign in with the test user**

Enter the email (used as username) + the temporary password from the welcome email. Cognito prompts you to set a new password (12+ chars, mixed case, includes a number — matches the password policy from `cognito.tf`).

- [ ] **Step 4: Verify the redirect (URL contains the code, even though navigation fails)**

After setting a new password, Cognito issues a 302 with `Location: https://cms.brigitte-le-roux.com/?code=<authorization-code>&state=<...>`. The browser tries to follow it and fails with a DNS error (`DNS_PROBE_FINISHED_NXDOMAIN` or `ERR_NAME_NOT_RESOLVED` in Chrome/Firefox/Safari, depending on browser).

**Check the URL bar after the error page renders.** The URL should be:
`https://cms.brigitte-le-roux.com/?code=<long-string>&state=<value>`

If you see the `?code=` parameter, the OAuth flow worked. The DNS failure is expected and not a bug.

If the URL bar shows no `?code=` parameter, OR the redirect went somewhere unexpected, the App Client config is wrong — check Cognito console → User pools → App integration → App clients → Login pages → Allowed callback URLs.

---

### Task 7: Verify the API Gateway endpoint responds + CORS works

The API has no routes yet, so any request returns 404. We verify the API is alive AND that CORS preflight succeeds.

- [ ] **Step 1: Check that the endpoint is reachable**

```bash
API=$(terraform -chdir=packages/infrastructure output -raw cms_api_endpoint)
curl -sI "$API/git/anything" | head -1
```

Expected: `HTTP/2 404` or similar — proves the API is reachable; 404 is correct because no route is defined yet.

- [ ] **Step 2: CORS preflight**

```bash
curl -si -X OPTIONS \
  -H "Origin: https://cms.brigitte-le-roux.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  "$API/git/anything" | head -10
```

Expected: a response that includes:
- `HTTP/2 204` (no content, which is correct for CORS preflight)
- `access-control-allow-origin: https://cms.brigitte-le-roux.com`
- `access-control-allow-methods: GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH` (or a subset matching the request)
- `access-control-allow-headers: authorization,content-type`

If CORS headers are missing, the `cors_configuration` block didn't apply correctly — check `api-gateway.tf`.

- [ ] **Step 3: Confirm a wrong origin is rejected**

```bash
curl -si -X OPTIONS \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST" \
  "$API/git/anything" | head -10
```

Expected: response is `HTTP/2 204` BUT lacks the `access-control-allow-origin` header for `evil.example.com` — that absence is what browsers use to reject the request. (API Gateway always returns 204; the CORS check is enforced by the browser based on response headers.)

---

### Task 8: Stage, review, commit

- [ ] **Step 1: Stage**

Run: `git add packages/infrastructure/cognito.tf packages/infrastructure/api-gateway.tf`

- [ ] **Step 2: Review staged diffs**

Run: `git status --short`

Expected:
```
A  packages/infrastructure/api-gateway.tf
A  packages/infrastructure/cognito.tf
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
infra(cms): Cognito User Pool + API Gateway HTTP API scaffold

Set up the auth + API entry point for the CMS without any Lambda code
or routes yet. Sveltia (Plan 6) and the Lambdas (Plans 4-5) will plug
into these resources later.

- packages/infrastructure/cognito.tf
  User pool "brigitte-le-roux-website-cms": email-as-username, admin-only
  user creation, 12-char min password with mixed case + numbers, optional
  TOTP MFA, verified-email account recovery. Public SPA app client with
  OAuth Authorization Code + PKCE, callback https://cms.brigitte-le-roux.com/,
  1h access tokens, 30d refresh tokens. Cognito-managed Hosted UI domain
  (prefix brigitte-le-roux-website-cms).

- packages/infrastructure/api-gateway.tf
  HTTP API + default $default auto-deploy stage. JWT authorizer wired to
  the Cognito user pool. CORS locked to https://cms.brigitte-le-roux.com.
  No routes yet — added with the Lambdas in Plan 4 under the /api/ prefix
  to match the unified-subdomain architecture.

CMS end-state architecture: cms.brigitte-le-roux.com served by CloudFront
with two origins — S3 (Sveltia UI) by default, API Gateway for /api/*.
ACM certs for cms.* already exist (admin-created). The CloudFront
distribution itself lands in a follow-up plan.
EOF
)"
```

Expected: commit lands. Confirm with `git log --oneline -3`.

---

### Task 9: Push to `main`

The push won't trigger the website-deploy workflow (path filter doesn't match `packages/infrastructure/**`), so this is just a regular push.

- [ ] **Step 1: Push**

Run: `git push origin main`

Expected: succeeds.

- [ ] **Step 2: Confirm no workflow run was triggered**

Run: `gh run list --workflow=deploy-website.yml --limit 1 --json status,conclusion,headSha`

Expected: the most recent run is the one from the previous plan (Plan 2's first deploy). NO new run with HEAD SHA of this commit.

---

## Self-Review

**Spec coverage** (against spec §3 — Editor auth + Cognito User Pool / API Gateway HTTP API sections):

| Spec requirement | Plan task |
| --- | --- |
| User Pool `brigitte-le-roux-website-cms` | Task 2 |
| Email as username | Task 2 |
| Password policy 12 chars, mixed case, number | Task 2 |
| MFA optional (TOTP) | Task 2 |
| Self-signup disabled (admin-only creation) | Task 2 + Task 5 |
| App Client: public, OAuth Auth Code + PKCE, callback /admin/, scopes openid+email | Task 2 |
| Hosted UI | Task 2 (Cognito-managed domain — see deviations below for the unified-subdomain decision) |
| Cognito email-based password reset | Task 2 (`recovery_mechanism = verified_email`) |
| HTTP API | Task 3 |
| JWT authorizer wired to Cognito | Task 3 |
| CORS allow CMS origin (now `https://cms.brigitte-le-roux.com`) | Task 3 |
| Routes `/git/{proxy+}`, `POST /media/upload-url` | NOT IN THIS PLAN — added in Plan 4 with the Lambdas. Routes will sit under `/api/` (e.g. `/api/git/*`, `POST /api/media/upload-url`) to match the unified-subdomain path scheme. |
| Custom subdomain for the CMS | NOT IN THIS PLAN — `cms.brigitte-le-roux.com` CloudFront distribution lands later. ACM certs already issued by admin. |

**Out of scope** (handled in later plans or as follow-ups):
- API Gateway routes + Lambda integrations (Plan 4 + Plan 5)
- Custom subdomains (`auth.*` and `cms-api.*`) — add ACM certs in us-east-1 (for Cognito) and eu-central-1 (for API Gateway), plus Route 53 records
- SSM Parameter Store for the GitHub App private key (Plan 4)
- Lambda execution roles (Plan 4)

**Deviations from spec**:
- Spec §3 specified TWO custom subdomains: `auth.brigitte-le-roux.com` (Cognito Hosted UI) and `cms-api.brigitte-le-roux.com` (API Gateway). This plan adopts a **unified single-subdomain architecture** for the CMS: one CloudFront distribution at `cms.brigitte-le-roux.com` with two origins (S3 for Sveltia UI, API Gateway for `/api/*` Lambda routes). Wins: same-origin removes CORS friction, one cert, one DNS record. The CloudFront distribution itself isn't built in this plan — it lands later when there's something real to serve. ACM certs are already issued by the administrator (see Architecture section).
- Cognito Hosted UI uses the AWS-managed prefix domain `brigitte-le-roux-website-cms.auth.<region>.amazoncognito.com` — adding a custom domain on top of Cognito would require additional config (separate cert, A record, Cognito user pool domain resource). Acceptable since Brigitte spends only the login moment on that URL; the rest of her session is on `cms.brigitte-le-roux.com`.
