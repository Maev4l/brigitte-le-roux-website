# CI/CD — Website Auto-Deploy via GitHub Actions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a commit lands on `main` that touches `packages/website/**`, the site auto-builds, syncs to S3, and CloudFront is invalidated — within a couple of minutes, with no AWS credentials in GitHub secrets.

**Architecture:** A single GitHub Actions workflow (`deploy-website.yml`) authenticates to AWS via OIDC (no long-lived keys) by assuming a narrowly-scoped IAM role. The role is created via Terraform in `packages/infrastructure/iam-gha.tf`. Trust policy locks the role to two repo refs: `refs/heads/main` (production) and `refs/heads/cms` (so we can `workflow_dispatch` the workflow from the dev branch to smoke-test before merging to main). After cutover, a follow-up tightens trust to `main`-only. The workflow syncs only the HTML/CSS/JS portion of `dist/` to S3, deliberately excluding the binary prefixes (`pdfs/*`, `data/*`, `img/*`) so the canonical-in-S3 invariant for those is preserved. CloudFront is invalidated with `--paths "/*"` (free-tier-safe: counts as one path).

**Tech Stack:** GitHub Actions, AWS IAM (OIDC), Terraform, `aws-actions/configure-aws-credentials@v4`, `actions/checkout@v4`, `actions/setup-node@v4`, `actions/github-script@v7`.

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §5.

---

## Preconditions

- On branch `cms`. `git rev-parse --abbrev-ref HEAD` reports `cms`.
- Refactor commit `14e7d9d` (or its descendant) is in the branch tip.
- `git status --porcelain` is empty.
- The remote `origin` points at `git@github.com:Maev4l/brigitte-le-roux-website.git`.
- `yarn infra:plan` works locally (proves Terraform state + AWS creds are healthy).
- `aws sts get-caller-identity` returns the AWS account ID `671123374425` (matches the project's existing AWS account; if not, stop and consult the administrator).
- `gh` CLI is available locally (for the smoke test). Run `gh auth status` to confirm.

## Approach notes

- **One commit at the end** of agent work (the workflow + Terraform changes land together). Mirrors Plan 1's approach.
- **Terraform applies during execution** (Task 3) — this is real infrastructure change, not just code. The change is additive (creates an OIDC provider + role; does not modify the website bucket or CloudFront). Safe.
- **No push during execution.** The administrator pushes after the smoke test.
- **The first workflow run is via `workflow_dispatch` on `cms`** (Task 6). This lets us verify the auto-deploy end-to-end without merging to main first. If anything is wrong, the website is unaffected.
- **The administrator's merge of `cms` → `main` is out of scope** for this plan. It's the production cutover, called out as the closing checkpoint (Task 9).

---

### Task 1: Verify preconditions

**Files:** None modified.

- [ ] **Step 1: Confirm branch + clean tree**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: first command prints `cms`; second command prints nothing.

- [ ] **Step 2: Confirm AWS identity matches the expected account**

Run: `aws sts get-caller-identity --query Account --output text`

Expected: `671123374425`.

If this returns a different account, stop and consult the administrator — the rest of the plan hardcodes the account ID.

- [ ] **Step 3: Confirm `gh` CLI is authenticated**

Run: `gh auth status`

Expected: shows a logged-in account with `write` scope on `Maev4l/brigitte-le-roux-website`. If not, run `gh auth login` (interactive — administrator may need to do this) before continuing.

- [ ] **Step 4: Confirm Terraform state is healthy**

Run: `yarn infra:plan 2>&1 | tail -5`

Expected: "No changes. Your infrastructure matches the configuration."

If there's drift (pending changes), stop and resolve before introducing new resources.

---

### Task 2: Add the GitHub OIDC provider + deploy role in Terraform

**Files:**
- Create: `packages/infrastructure/iam-gha.tf`

- [ ] **Step 1: Write `packages/infrastructure/iam-gha.tf`**

Create the file with exactly this content:

```hcl
# ---------------------------------------------------------------------------
# GitHub Actions → AWS OIDC
# Lets GitHub Actions workflows running in this repo assume a tightly-scoped
# IAM role without long-lived AWS access keys stored in GitHub secrets.
# ---------------------------------------------------------------------------

# GitHub's OIDC provider for AWS. Only one of these can exist per account;
# this resource is shared across any future GHA-deployed projects in this
# account (intentional).
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]

  # AWS auto-verifies GitHub's certificate chain since mid-2023, so the
  # thumbprint is no longer load-bearing — but Terraform's schema still
  # requires the field. The published thumbprint:
  # https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Trust policy: only allow this specific repo, and only on refs we explicitly
# list. During development we accept `main` AND `cms` so the workflow can be
# smoke-tested via workflow_dispatch on the dev branch. Once Plan 1 is merged
# to main, tighten this to `main` only (follow-up commit; see plan §Task 9).
data "aws_iam_policy_document" "gha_website_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:Maev4l/brigitte-le-roux-website:ref:refs/heads/main",
        "repo:Maev4l/brigitte-le-roux-website:ref:refs/heads/cms",
      ]
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
```

- [ ] **Step 2: Format and validate**

Run:
```bash
terraform -chdir=packages/infrastructure fmt iam-gha.tf
terraform -chdir=packages/infrastructure validate
```

Expected: `fmt` prints nothing (or the file name if it reformatted); `validate` prints `Success! The configuration is valid.`

If `validate` errors, fix the file and re-run.

---

### Task 3: Run `terraform plan` then `terraform apply`

**Files:** None modified; this applies infrastructure changes.

- [ ] **Step 1: Plan**

Run: `yarn infra:plan`

Expected: plan shows 4 resources to add:
- `aws_iam_openid_connect_provider.github` (Add)
- `aws_iam_role.gha_website_deploy` (Add)
- `aws_iam_role_policy.gha_website_deploy` (Add)
- `data.aws_iam_policy_document.gha_website_deploy_trust` (Read)
- `data.aws_iam_policy_document.gha_website_deploy` (Read)

And one output added:
- `gha_website_deploy_role_arn` (known after apply)

No `change` or `destroy` actions. If any existing resource appears in the change set, stop and inspect — the plan is meant to be purely additive.

- [ ] **Step 2: Apply**

Run: `yarn infra:apply`

Expected: succeeds. The output should print the role ARN at the end:
```
gha_website_deploy_role_arn = "arn:aws:iam::671123374425:role/gha-website-deploy"
```

Record this ARN — it goes into the workflow YAML in Task 4.

- [ ] **Step 3: Confirm the role + OIDC provider exist**

Run:
```bash
aws iam get-role --role-name gha-website-deploy --query 'Role.Arn' --output text
aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[?contains(Arn,`token.actions.githubusercontent.com`)].Arn' --output text
```

Expected: first command prints `arn:aws:iam::671123374425:role/gha-website-deploy`; second command prints the OIDC provider ARN (non-empty).

---

### Task 4: Write the GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy-website.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/deploy-website.yml` with exactly this content:

```yaml
# Auto-deploy the Astro static site on push to main.
# Auth to AWS via OIDC (no long-lived secrets in GitHub).
# See docs/superpowers/specs/2026-05-20-content-editing-cms-design.md §5.

name: Deploy website

on:
  push:
    branches: [main]
    paths:
      - 'packages/website/**'
      - '.github/workflows/deploy-website.yml'
  workflow_dispatch: {}

permissions:
  id-token: write     # required for OIDC token issuance
  contents: read      # required by actions/checkout

concurrency:
  group: deploy-website
  cancel-in-progress: false

env:
  AWS_REGION: eu-central-1
  S3_BUCKET: brigitte-le-roux-website
  CF_DISTRIBUTION_ID: E36ANPC8D6F1WW
  DEPLOY_ROLE_ARN: arn:aws:iam::671123374425:role/gha-website-deploy

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: yarn
          cache-dependency-path: packages/website/yarn.lock

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ env.DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Install dependencies
        run: yarn --cwd packages/website install --frozen-lockfile

      - name: Build
        run: yarn --cwd packages/website build

      # Sync built site to S3 EXCEPT the binary prefixes (pdfs/, data/, img/).
      # Those are canonical in S3, managed independently (CMS uploads via the
      # media-uploader Lambda OR via `yarn frontend:pull` + manual replacement).
      # --exclude on `aws s3 sync --delete` prevents both upload AND deletion
      # of matched paths, leaving the binary prefixes untouched on S3.
      - name: Sync to S3
        run: |
          aws s3 sync packages/website/dist/ "s3://${S3_BUCKET}/" --delete \
            --exclude "pdfs/*" --exclude "data/*" --exclude "img/*"

      - name: Invalidate CloudFront
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "${CF_DISTRIBUTION_ID}" \
            --paths "/*" \
            --output text > /dev/null

      # If the deploy failed and was triggered by a push (not workflow_dispatch),
      # leave a French commit-comment so the user (editing via the CMS, when
      # that ships) sees something in the Sveltia commit list.
      - name: Comment on commit on failure
        if: failure() && github.event_name == 'push'
        uses: actions/github-script@v7
        with:
          script: |
            const runUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
            await github.rest.repos.createCommitComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              commit_sha: context.sha,
              body: `⚠️ Une erreur empêche la mise en ligne — l'administrateur a été notifié.\n\nLogs : ${runUrl}`,
            });
```

- [ ] **Step 2: Verify YAML is parseable**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-website.yml'))" && echo OK
```

Expected: `OK`. If it errors, fix the YAML.

- [ ] **Step 3: Static-check the workflow with `actionlint` if available**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/deploy-website.yml || echo "(actionlint not installed — skip)"`

Expected: no actionlint errors, OR the "actionlint not installed" notice (in which case skip).

---

### Task 5: Stage and review the workflow + Terraform changes

**Files:** None modified beyond Tasks 2-4.

- [ ] **Step 1: Stage**

Run: `git add packages/infrastructure/iam-gha.tf .github/workflows/deploy-website.yml`

- [ ] **Step 2: Show the staged set**

Run: `git status --short`

Expected (exactly these two entries):
```
A  .github/workflows/deploy-website.yml
A  packages/infrastructure/iam-gha.tf
```

Plus possibly an untracked entry for the auto-generated `.terraform.lock.hcl` update — that's gitignored, ignore it.

- [ ] **Step 3: Eyeball the diffs**

Run:
```bash
git diff --cached --stat
git diff --cached -- packages/infrastructure/iam-gha.tf | head -30
```

Just sanity-check the Terraform file has the expected resources (provider, trust doc, perms doc, role, policy attachment, output).

---

### Task 6: Smoke-test via `workflow_dispatch` on `cms`

This is the safety net before the production cutover: we trigger the workflow manually on the `cms` branch (which the OIDC trust policy allows) and verify it succeeds end-to-end.

- [ ] **Step 1: Commit the staged changes**

The workflow file needs to be pushed to GitHub before `gh workflow run` can find it. Commit on the `cms` branch:

```bash
git commit -m "$(cat <<'EOF'
ci: add GitHub Actions website-deploy workflow + IAM OIDC role

- packages/infrastructure/iam-gha.tf
  Define the GitHub OIDC provider and a narrowly-scoped IAM role
  (gha-website-deploy) trusted by this repo's main + cms refs. Permissions
  cover the bare minimum the deploy needs: s3 list/get/put/delete on the
  website bucket, and cloudfront:CreateInvalidation on its distribution.

- .github/workflows/deploy-website.yml
  Trigger on push to main when packages/website/** changes (and on manual
  workflow_dispatch). Build the Astro site, sync to S3 excluding binary
  prefixes (pdfs/data/img stay canonical in S3), invalidate CloudFront.
  On push-triggered failure, post a French commit comment so the user sees
  something when CMS work lands.

Trust policy permits `cms` ref temporarily so we can smoke-test via
workflow_dispatch before merging to main; tightened to main-only in a
follow-up after the production cutover.

See docs/superpowers/specs/2026-05-20-content-editing-cms-design.md §5.
EOF
)"
```

Expected: commit succeeds. Confirm with `git log --oneline -1`.

- [ ] **Step 2: Push the cms branch**

Run: `git push origin cms`

Expected: succeeds. The new commit appears on `origin/cms`.

- [ ] **Step 3: Trigger the workflow manually on `cms`**

Run: `gh workflow run deploy-website.yml --ref cms`

Expected: succeeds silently (returns to prompt).

- [ ] **Step 4: Wait for the run and capture its outcome**

Run: `gh run watch --exit-status`

(Selects the most recent run if there are multiple.)

Expected: prints status updates and exits with code 0 when the run succeeds.

If it fails, run `gh run view --log-failed` to see what broke. Common issues:
- OIDC role ARN mismatch → check the env var matches the Terraform output from Task 3.
- Permissions error → re-check the IAM policy in iam-gha.tf.
- yarn install fail → confirm the lockfile is intact.

Fix and re-run with `gh workflow run deploy-website.yml --ref cms`.

- [ ] **Step 5: Sanity-check the live site**

Run:
```bash
curl -sI https://brigitte-le-roux.com/ | head -1
curl -sI https://brigitte-le-roux.com/cv/ | head -1
```

Expected: both return `HTTP/2 200`. If either returns a 4xx/5xx, the deploy broke something — investigate via `gh run view --log` before proceeding.

---

### Task 7: Verify only the expected paths were touched on S3

The workflow's `aws s3 sync ... --exclude "pdfs/*" --exclude "data/*" --exclude "img/*"` should not have touched any binary objects. Verify.

- [ ] **Step 1: List a few binary objects and confirm LastModified is OLD (predates the smoke test)**

Run:
```bash
aws s3api list-objects-v2 --bucket brigitte-le-roux-website --prefix pdfs/ --max-keys 3 \
  --query 'Contents[].[Key,LastModified]' --output table
aws s3api list-objects-v2 --bucket brigitte-le-roux-website --prefix img/ --max-keys 3 \
  --query 'Contents[].[Key,LastModified]' --output table
```

Expected: the LastModified timestamps for pdfs/* and img/* entries are unchanged (predate today's smoke-test deploy).

- [ ] **Step 2: Confirm the HTML files DID get updated**

Run:
```bash
aws s3api head-object --bucket brigitte-le-roux-website --key index.html \
  --query 'LastModified' --output text
```

Expected: today's date — proves the workflow successfully synced the HTML payload.

---

### Task 8: Final verification — local `yarn frontend:deploy` is still the safe escape hatch

The existing local `yarn frontend:deploy` script must continue to work in case GitHub Actions is down or you need an emergency manual deploy.

- [ ] **Step 1: Dry-run-equivalent: make a no-op edit and confirm the local deploy succeeds**

Run: `yarn frontend:build`

Expected: succeeds. No need to actually deploy — the build is the test.

- [ ] **Step 2: Confirm both deploy paths exist**

Run: `ls .github/workflows/deploy-website.yml packages/website/scripts/deploy.sh`

Expected: both files listed. Both are kept; the workflow is the primary, the script is the escape hatch.

---

### Task 9: PAUSE — administrator merges `cms` → `main` to enable auto-deploy in production

This task is NOT executed by the implementing agent. The agent reports completion and stops.

**For the administrator:**

The CMS work-in-progress (refactor + workflow + future Plans 3-7) accumulates on the `cms` branch. Once you're ready to flip auto-deploy on for real production-side, merge `cms` to `main`. Recommended approach: open a PR on GitHub for visual diff review.

```bash
# Option A: command-line merge
git checkout main
git merge --no-ff cms
git push origin main

# Option B: PR via gh
gh pr create --base main --head cms --title "Enable monorepo + auto-deploy" --body "Plan 1 + Plan 2"
# Then merge the PR on GitHub.
```

After the merge:

1. **First production auto-deploy fires.** The workflow runs on `main` because of the `packages/website/**` path filter. Watch it:
   ```bash
   gh run watch --exit-status
   ```

2. **Verify the live site at https://brigitte-le-roux.com/** still works.

3. **Tighten the OIDC trust policy.** Edit `packages/infrastructure/iam-gha.tf` to remove the `cms` ref from the trust subject list (leaving only `main`). Apply:
   ```bash
   yarn infra:apply
   ```
   Commit on `main` (or via PR) with message:
   ```
   ci: tighten GitHub OIDC trust to main-only

   Now that cutover is done and the workflow is verified on main, drop the
   cms ref from the trust policy. No more workflow_dispatch from feature
   branches via this role.
   ```

4. **From this point on**, every commit to `main` that touches `packages/website/**` auto-deploys. The local `yarn frontend:deploy` remains as an emergency escape hatch but should not be the normal path.

Once cutover is complete, the next plan (Plan 3 — Cognito + API Gateway scaffolding for the CMS) can begin.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §5):

| Spec requirement | Plan task |
| --- | --- |
| Workflow triggers on push to `main` + path filter on `packages/website/**` | Task 4 |
| OIDC auth via `aws-actions/configure-aws-credentials@v4` | Task 4 |
| Steps: checkout, setup-node, yarn install, yarn build | Task 4 |
| (Spec used `yarn pull` to fetch binaries.) Plan **deviates**: omits the pull step; instead `aws s3 sync --exclude` leaves binary prefixes untouched on S3. Cleaner, faster, equivalent end state. | Task 4 + Task 7 |
| `aws s3 sync packages/website/dist/ s3://<bucket>/ --delete` | Task 4 |
| `aws cloudfront create-invalidation --paths "/*"` | Task 4 |
| Single OIDC role `gha-website-deploy` with narrow perms | Task 2 |
| Trust subject locked to `repo:Maev4l/brigitte-le-roux-website:ref:refs/heads/main` | Task 2 + Task 9 (tightening) |
| Failure email to administrator (via GitHub repo notification settings) | NOT IN THIS PLAN — manual repo setting; flagged at Task 9 |
| Failure commit comment in French | Task 4 |
| CODEOWNERS | NOT IN THIS PLAN — deferred to a small follow-up plan or done manually when CMS lands |

**Out of scope for this plan** (handled later):
- CODEOWNERS file
- Branch protection on `main` (GitHub UI setting)
- GitHub repo notification settings → email administrator on Actions failure (manual UI step)
- CMS-specific infrastructure (Cognito, API Gateway, Lambdas, SSM) — Plan 3+

**Plan deviation worth flagging in the implementation**:
- Spec §5 Workflow step 5 was `yarn pull --delete` (sync `public/` from S3 into the runner). This plan omits that. Reason: Astro build doesn't need the binaries on disk to generate HTML (URLs are absolute `/pdfs/foo.pdf` resolved at runtime via CloudFront). Plus the `aws s3 sync --exclude` on the deploy step prevents accidentally clobbering the binary prefixes. Net: faster CI run, fewer moving parts, same end state. Document this in the post-execution PR description for the spec maintainer's awareness.
