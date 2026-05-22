# Monorepo Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the repo from a single-Astro-project layout to a monorepo (`packages/website/`, `packages/infrastructure/`) without changing any runtime behaviour. End at a pause point for the administrator to commit, create the public GitHub remote, and push.

**Architecture:** Pure structural refactor. `git mv` preserves file history. A slim root `package.json` (scripts only — no deps) carries namespaced convenience commands (`frontend:*`, `infra:*`) that delegate via `yarn --cwd` and `terraform -chdir`. Two scripts (`deploy.sh`, `pull-public.sh`) need a small path tweak because they reference `terraform -chdir=infrastructure` and that target becomes `../infrastructure` relative to the scripts' new working directory. `.gitignore` paths shift to `packages/website/...` and `packages/infrastructure/...`. `CLAUDE.md` is updated to drop the now-incorrect "no workspaces / single Astro project at the repo root" statement and document the new layout.

**Tech Stack:** Yarn (no workspaces), bash scripts, Terraform, Astro 5.

**Reference spec:** `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §0.

---

## Preconditions

- Working tree is clean: `git status` shows no uncommitted changes.
- Current branch is `main`. No remote configured (`.git/config` has no `[remote "origin"]` block).
- All current `yarn` commands work today: `yarn dev`, `yarn build`, `yarn pull`, `yarn deploy`, `yarn infra:plan`.

## Approach notes

- **One commit at the end** (per spec §0 "Refactor steps (one commit)"). Don't commit during execution.
- **Do NOT push.** That's the administrator's manual step after the pause (Task 11).
- **Do NOT run `yarn frontend:deploy`** during verification — it would actually push to S3. Verification only exercises read-only commands.
- `node_modules/`, `dist/`, `.astro/` are gitignored and not in any commit; they are re-created in `packages/website/` after the move.
- This refactor lands directly on `main` since there is no remote yet — no protected-branch issue.

---

### Task 1: Verify clean working tree and capture pre-refactor baseline

**Files:** None modified.

- [ ] **Step 1: Confirm clean tree**

Run: `git status --porcelain`

Expected: empty output (no lines). If non-empty, stop and resolve those changes first.

- [ ] **Step 2: Confirm we are on `main` and no remote exists**

Run: `git branch --show-current && echo --- && git remote -v`

Expected:
```
main
---
```
(the `git remote -v` output is empty).

- [ ] **Step 3: Capture build baseline**

Run: `yarn install --frozen-lockfile && yarn build`

Expected: build succeeds, `dist/` exists. Note the build time and any warnings in the output — they should re-appear unchanged after the refactor.

- [ ] **Step 4: Capture `terraform plan` baseline**

Run: `yarn infra:plan`

Expected: completes successfully. Most likely "No changes. Your infrastructure matches the configuration." If the plan shows pending changes, those should re-appear identically after the refactor.

---

### Task 2: Move the Astro project under packages/website/

**Files moved (via `git mv`):**
- `astro.config.mjs` → `packages/website/astro.config.mjs`
- `package.json` → `packages/website/package.json`
- `yarn.lock` → `packages/website/yarn.lock`
- `src/` → `packages/website/src/`
- `content/` → `packages/website/content/`
- `scripts/` → `packages/website/scripts/`

- [ ] **Step 1: Create the destination directory**

Run: `mkdir -p packages/website`

Expected: succeeds silently.

- [ ] **Step 2: Move each top-level Astro item with `git mv`**

Run:
```bash
git mv astro.config.mjs packages/website/
git mv package.json     packages/website/
git mv yarn.lock        packages/website/
git mv src              packages/website/
git mv content          packages/website/
git mv scripts          packages/website/
```

Expected: each command succeeds silently.

- [ ] **Step 3: Verify the move via `git status`**

Run: `git status`

Expected: includes six renamed entries (one per item). Example:
```
renamed:    astro.config.mjs -> packages/website/astro.config.mjs
renamed:    package.json -> packages/website/package.json
renamed:    yarn.lock -> packages/website/yarn.lock
renamed:    src/... -> packages/website/src/...
renamed:    content/... -> packages/website/content/...
renamed:    scripts/... -> packages/website/scripts/...
```

Do NOT commit yet — many more changes coming.

---

### Task 3: Move infrastructure under packages/infrastructure/

**Files moved (via `git mv`):**
- `infrastructure/` → `packages/infrastructure/`

- [ ] **Step 1: Move the folder**

Run: `git mv infrastructure packages/infrastructure`

Expected: succeeds silently.

- [ ] **Step 2: Verify**

Run: `ls packages/infrastructure/`

Expected (exactly these 8 files):
```
cloudfront-site-function.js
cloudfront.tf
dns.tf
main.tf
outputs.tf
s3.tf
variables.tf
versions.tf
```
(The CloudFront function source was named `cloudfront-function.js` during Plan 1; it was later renamed to `cloudfront-site-function.js` as part of Plan 6 for symmetry with a new `cloudfront-cms-function.js`. The pre-rename name is the one a present-day clone will see if Plan 1 is re-run against the original-state filesystem.)

- [ ] **Step 3: Verify `git status`**

Run: `git status`

Expected: now includes renames for each `.tf` file and `cloudfront-site-function.js` (named `cloudfront-function.js` at Plan 1 time; renamed in Plan 6):
```
renamed:    infrastructure/main.tf -> packages/infrastructure/main.tf
renamed:    infrastructure/s3.tf -> packages/infrastructure/s3.tf
... etc
```

---

### Task 4: Update scripts/deploy.sh and pull-public.sh for the new Terraform path

The two scripts run from inside `packages/website/` (because each script does `cd "$(dirname "$0")/.."` and the script files are now at `packages/website/scripts/*.sh`). They reference `terraform -chdir=infrastructure`, which after the refactor must become `terraform -chdir=../infrastructure`.

`check-links.sh` does not reference Terraform and needs no change.

**Files:**
- Modify: `packages/website/scripts/deploy.sh` (3 occurrences on lines 6, 7, 44)
- Modify: `packages/website/scripts/pull-public.sh` (1 occurrence on line 26)

- [ ] **Step 1: Update `packages/website/scripts/deploy.sh`**

Edit `packages/website/scripts/deploy.sh`. Find each occurrence of `terraform -chdir=infrastructure` and replace with `terraform -chdir=../infrastructure`. There are three occurrences:

Line 6:
```bash
BUCKET=$(terraform -chdir=infrastructure output -raw bucket_name)
```
becomes
```bash
BUCKET=$(terraform -chdir=../infrastructure output -raw bucket_name)
```

Line 7:
```bash
DIST_ID=$(terraform -chdir=infrastructure output -raw cloudfront_distribution_id)
```
becomes
```bash
DIST_ID=$(terraform -chdir=../infrastructure output -raw cloudfront_distribution_id)
```

Line 44:
```bash
echo "==> Done: https://$(terraform -chdir=infrastructure output -raw cloudfront_domain)/"
```
becomes
```bash
echo "==> Done: https://$(terraform -chdir=../infrastructure output -raw cloudfront_domain)/"
```

- [ ] **Step 2: Update `packages/website/scripts/pull-public.sh`**

Line 26:
```bash
BUCKET=$(terraform -chdir=infrastructure output -raw bucket_name)
```
becomes
```bash
BUCKET=$(terraform -chdir=../infrastructure output -raw bucket_name)
```

- [ ] **Step 3: Verify the four updates**

Run: `grep -nE "terraform -chdir=" packages/website/scripts/`

Expected: exactly four matches, all pointing to `../infrastructure`:
```
deploy.sh:6:    BUCKET=$(terraform -chdir=../infrastructure output -raw bucket_name)
deploy.sh:7:    DIST_ID=$(terraform -chdir=../infrastructure output -raw cloudfront_distribution_id)
deploy.sh:44:   echo "==> Done: https://$(terraform -chdir=../infrastructure output -raw cloudfront_domain)/"
pull-public.sh:26: BUCKET=$(terraform -chdir=../infrastructure output -raw bucket_name)
```

If any line still says `chdir=infrastructure` (without `../`), it wasn't updated.

---

### Task 5: Update root `.gitignore` for new paths

**Files:**
- Modify: `.gitignore` (replace entire file)

- [ ] **Step 1: Replace `.gitignore` content**

Replace the contents of `.gitignore` with:

```
# Dependencies
node_modules/
yarn-error.log
yarn-debug.log

# Build output
packages/website/dist/
packages/website/.astro/

# Site binaries — canonical store is S3 (populated locally by hand, uploaded by `yarn frontend:deploy`).
# These files are NOT tracked in git: some exceed GitHub's 100 MB per-file hard limit, and the
# build/deploy pipeline already treats S3 as the source of truth. See CLAUDE.md for the recovery
# procedure if `public/` needs to be repopulated from S3.
packages/website/public/*

# Favicon set — small identity files; track in git so fresh clones get them
# without needing `yarn frontend:pull` first. Whitelisted out of the public/* rule above.
!packages/website/public/favicon.svg
!packages/website/public/favicon.ico
!packages/website/public/apple-touch-icon.png

# OS
.DS_Store
Thumbs.db

# Editors
.vscode/
.idea/
*.swp
*.swo

# Brainstorming session caches (specs/plans tracked under docs/ instead)
.superpowers/

# Local env
.env
.env.local
.env.*.local

# Terraform — state and local workspace (lock file is committed for reproducibility)
packages/infrastructure/.terraform/
packages/infrastructure/terraform.tfstate
packages/infrastructure/terraform.tfstate.backup
packages/infrastructure/terraform.tfvars
packages/infrastructure/.terraform.lock.hcl
```

- [ ] **Step 2: Verify no source files are newly ignored**

Run: `git status --ignored --short`

Expected: `!!` lines appear only for build artefacts and dependencies (e.g. `!! node_modules/`, `!! packages/website/dist/`, `!! packages/website/.astro/`, `!! packages/infrastructure/.terraform/`). NO line should reference anything under `packages/website/src/`, `packages/website/content/`, or `packages/infrastructure/*.tf`.

If a source file becomes newly ignored, the gitignore is wrong — re-check Step 1.

- [ ] **Step 3: Verify the three favicons stay tracked**

Run: `git check-ignore -v packages/website/public/favicon.svg packages/website/public/favicon.ico packages/website/public/apple-touch-icon.png`

Expected: no output (exit 1). If any file is ignored, the `!` un-ignore lines didn't take.

---

### Task 6: Create the slim root `package.json`

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write the new root package.json**

Write `package.json` at the repo root with this exact content:

```json
{
  "name": "brigitte-le-roux-website",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "frontend:dev":     "yarn --cwd packages/website dev",
    "frontend:build":   "yarn --cwd packages/website build",
    "frontend:pull":    "yarn --cwd packages/website pull",
    "frontend:deploy":  "yarn --cwd packages/website deploy",
    "infra:plan":       "terraform -chdir=packages/infrastructure plan",
    "infra:apply":      "terraform -chdir=packages/infrastructure apply -auto-approve"
  }
}
```

Notes:
- No `dependencies` / `devDependencies` block — those stay in `packages/website/package.json`.
- `backend:build` / `backend:deploy` will be added in a later plan when `packages/functions/` is created.
- `check:links` is not exposed at the root for now — invoke via `yarn --cwd packages/website check:links` if needed.

- [ ] **Step 2: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && echo OK`

Expected: `OK` printed (exit 0). If it errors, fix the JSON.

---

### Task 7: Remove the duplicate `infra:*` scripts from the Astro package.json

The Astro project's own `package.json` (now at `packages/website/package.json`) still has `infra:plan` and `infra:apply` referencing `terraform -chdir=infrastructure`. After Task 3 that relative path is wrong, AND we already expose `infra:*` at the root from Task 6. Remove the duplicates.

**Files:**
- Modify: `packages/website/package.json` (remove `infra:plan` and `infra:apply` keys)

- [ ] **Step 1: Edit `packages/website/package.json`**

Replace the `"scripts"` block:

```json
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview --port 4321",
    "pull": "bash scripts/pull-public.sh",
    "deploy": "bash scripts/deploy.sh",
    "check:links": "bash scripts/check-links.sh",
    "infra:plan": "terraform -chdir=infrastructure plan",
    "infra:apply": "terraform -chdir=infrastructure apply -auto-approve"
  },
```

with:

```json
  "scripts": {
    "dev": "astro dev --port 4321",
    "build": "astro build",
    "preview": "astro preview --port 4321",
    "pull": "bash scripts/pull-public.sh",
    "deploy": "bash scripts/deploy.sh",
    "check:links": "bash scripts/check-links.sh"
  },
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/website/package.json','utf8'))" && echo OK`

Expected: `OK`.

---

### Task 8: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Stack section**

Find these lines in `CLAUDE.md`:

```
## Stack

- Astro 5 (static output), Yarn, strict version pinning, no TypeScript, no workspaces.
- Single Astro project at the repo root. Dev server on port `4321`.
- Theme tokens in `src/styles/theme.css` — Fraunces (display), Bricolage Grotesque (UI),
  vermillion kicker on parchment ground.
```

Replace with:

```
## Stack

- Astro 5 (static output), Yarn, strict version pinning, no TypeScript.
- Monorepo layout: `packages/website/` (Astro site), `packages/infrastructure/`
  (Terraform). Yarn workspaces are NOT used — the root `package.json` only
  carries namespaced convenience scripts (`frontend:*`, `infra:*`) that
  delegate via `yarn --cwd` and `terraform -chdir`. Each package has its own
  `package.json` with its own strict-pinned deps. Dev server on port `4321`.
- Theme tokens in `packages/website/src/styles/theme.css` — Fraunces (display),
  Bricolage Grotesque (UI), vermillion kicker on parchment ground.
```

- [ ] **Step 2: Update the Build & deploy section**

Find:

```bash
yarn install
yarn dev                # http://localhost:4321
yarn build              # → dist/
yarn deploy             # build + S3 sync + CloudFront invalidation
yarn infra:plan         # terraform plan
yarn infra:apply        # terraform apply
```

Replace with:

```bash
yarn --cwd packages/website install
yarn frontend:dev       # http://localhost:4321
yarn frontend:build     # → packages/website/dist/
yarn frontend:pull      # sync packages/website/public/ from S3
yarn frontend:deploy    # build + S3 sync + CloudFront invalidation
yarn infra:plan         # terraform plan
yarn infra:apply        # terraform apply
```

- [ ] **Step 3: Update path references in prose**

Apply the following find-and-replace pairs to `CLAUDE.md`. Each is a simple textual replacement — use a sequence of targeted Edits, not a `sed` script, because some occurrences are inside code fences with surrounding context that matters.

| Find | Replace with |
| --- | --- |
| `` `src/content/config.mjs` `` | `` `packages/website/src/content/config.mjs` `` |
| `` `content/pages/`` | `` `packages/website/content/pages/`` |
| `` `content/i18n/`` | `` `packages/website/content/i18n/`` |
| `` `src/pages/[...slug].astro` `` | `` `packages/website/src/pages/[...slug].astro` `` |
| `` `src/pages/en/[...slug].astro` `` | `` `packages/website/src/pages/en/[...slug].astro` `` |
| `` `src/components/Header.astro` `` | `` `packages/website/src/components/Header.astro` `` |
| `` `src/layouts/BaseLayout.astro` `` | `` `packages/website/src/layouts/BaseLayout.astro` `` |
| `` `src/pages/robots.txt.js` `` | `` `packages/website/src/pages/robots.txt.js` `` |
| `` `infrastructure/s3.tf` `` | `` `packages/infrastructure/s3.tf` `` |
| `` `infrastructure/` `` (when referring to the Terraform folder) | `` `packages/infrastructure/` `` |
| `` `public/pdfs/` `` | `` `packages/website/public/pdfs/` `` |
| `` `public/data/` `` | `` `packages/website/public/data/` `` |
| `` `public/img/` `` | `` `packages/website/public/img/` `` |
| `` `public/` `` (when referring to the static-assets folder) | `` `packages/website/public/` `` |

Also update:
- The `yarn pull` example commands in the "Pulling `public/` from S3" section: change `yarn pull` → `yarn frontend:pull` throughout.
- The `yarn deploy` example commands in the "Multi-writer workflow" section: change `yarn deploy` → `yarn frontend:deploy`.
- Any other `yarn dev`, `yarn build` standalone references → `yarn frontend:dev`, `yarn frontend:build`.

- [ ] **Step 4: Verify CLAUDE.md no longer makes the stale claims**

Run: `grep -nE "no workspaces|Single Astro project at the repo root" CLAUDE.md`

Expected: no matches.

- [ ] **Step 5: Verify all repo-root-relative paths are now monorepo-relative**

Run:
```bash
grep -nE "(^| |\`|\(|/)(src/(pages|components|layouts|content|styles)|content/(pages|i18n)|infrastructure/[a-z])" CLAUDE.md
```

Expected: every match is prefixed with `packages/website/` or `packages/infrastructure/`. Any unprefixed match is a leftover — fix and re-run.

(False positives can occur if a literal string genuinely refers to a directory at the website-package root — those *should* be prefixed. If you find a false positive that legitimately should not be prefixed, it's likely inside a Sveltia-config reference, not present in this plan's scope.)

---

### Task 9: Smoke-test the refactor end-to-end

Re-run every wrapper script and verify its behaviour matches the pre-refactor baseline from Task 1.

- [ ] **Step 1: Reinstall deps in the new location**

Run: `yarn --cwd packages/website install --frozen-lockfile`

Expected: completes successfully; `packages/website/node_modules/` is created. No `Lockfile not found` or version-mismatch errors.

(The pre-refactor `node_modules/` at the repo root from Task 1's install is now stale. The `.gitignore` still ignores it, but it can confuse some tools. Optional cleanup: `rm -rf node_modules/`.)

- [ ] **Step 2: Test `yarn frontend:build`**

Run: `yarn frontend:build`

Expected: build succeeds; `packages/website/dist/` is created with HTML output. Build duration should be within ±20 % of the Task 1 baseline.

- [ ] **Step 3: Test `yarn frontend:dev` briefly**

Run: `yarn frontend:dev`

In another shell or browser: visit `http://localhost:4321/`. Expected: home page renders identically to before the refactor.

Ctrl-C to stop the dev server.

- [ ] **Step 4: Test `yarn frontend:pull --dry-run`**

Run: `yarn frontend:pull --dry-run`

Expected: three `==> Syncing s3://...` headers (one per `pdfs`, `data`, `img` subtree), then per-file `(dryrun) download:` lines from `aws s3 sync`. No Terraform-output error. No actual file I/O.

If you see `Error: No Terraform configuration files in current directory`, the Task 4 path tweak in `pull-public.sh` didn't take.

- [ ] **Step 5: Test the `terraform -chdir=../infrastructure` resolution by hand**

Confirms `deploy.sh`'s Terraform reference works without actually deploying.

Run: `(cd packages/website && terraform -chdir=../infrastructure output -raw bucket_name)`

Expected: prints the S3 bucket name. No "No Terraform configuration files" error. (You may need to have already run `terraform init` once locally; if so, run `(cd packages/infrastructure && terraform init -reconfigure)` first.)

If the output is the correct bucket name, the same path will work inside `deploy.sh` itself.

- [ ] **Step 6: Test `yarn infra:plan`**

Run: `yarn infra:plan`

Expected: completes successfully. Output should match Task 1's baseline (likely "No changes. Your infrastructure matches the configuration.").

- [ ] **Step 7: Eyeball `git status` for sanity**

Run: `git status`

Expected:
- Many renames (Astro source, infrastructure files).
- Modified: `.gitignore`, `CLAUDE.md`, `packages/website/scripts/deploy.sh`, `packages/website/scripts/pull-public.sh`, `packages/website/package.json`.
- New file: `package.json` (the slim root one).
- Nothing under `packages/website/node_modules/`, `packages/website/dist/`, `packages/website/.astro/`, or `packages/infrastructure/.terraform/`. If any of these appear, the `.gitignore` paths are wrong — re-check Task 5.

If any smoke test fails, fix and re-verify before continuing. Do NOT proceed to the commit task with failing tests.

---

### Task 10: Commit the refactor

Single commit per spec §0.

- [ ] **Step 1: Stage everything**

Run: `git add -A`

- [ ] **Step 2: Show the staged set for one final review**

Run: `git status`

Expected: the rename + modification list from Task 9 Step 7. If anything unexpected appears (e.g. an accidentally-staged `node_modules/` or `.terraform/` entry), unstage it: `git restore --staged <path>`.

- [ ] **Step 3: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
chore: refactor to monorepo layout (packages/website + packages/infrastructure)

Move the Astro project under packages/website/ and the Terraform workspace
under packages/infrastructure/. Introduce a slim root package.json with
namespaced convenience scripts (frontend:dev, frontend:build, frontend:pull,
frontend:deploy, infra:plan, infra:apply) using yarn --cwd and
terraform -chdir. Adjust deploy.sh and pull-public.sh to reference
../infrastructure (Terraform now lives one level above the scripts' working
directory). Update .gitignore for the new paths. Update CLAUDE.md to drop
the now-stale "no workspaces" statement and document the new layout.

No runtime behaviour changes. Prerequisite for the CMS work documented in
docs/superpowers/specs/2026-05-20-content-editing-cms-design.md.
EOF
)"
```

Expected: commit succeeds. Verify with `git log --oneline -1`.

- [ ] **Step 4: Fresh-clone smoke test**

Guard against "works only because of stale state in my workspace". Tear down derived state and rebuild from scratch:

```bash
rm -rf node_modules packages/website/node_modules packages/website/dist packages/website/.astro
yarn --cwd packages/website install --frozen-lockfile
yarn frontend:build
yarn infra:plan
```

Expected: all three succeed; `packages/website/dist/` is regenerated; `infra:plan` shows the same output as Task 1's baseline.

---

### Task 11: PAUSE — administrator creates the GitHub remote and pushes

This task is NOT executed by the implementing agent. It is the explicit checkpoint at the end of §0. The agent reports the checkpoint and stops.

**For the administrator:**

1. Review the commit:
   ```bash
   git show HEAD
   git log --stat HEAD
   ```

2. Decide on the GitHub repo name. The spec assumes `Maev4l/brigitte-leroux-website` (matching the current local directory name, no extra hyphen between "le" and "roux"). If you'd rather use `brigitte-le-roux-website` (with the hyphen, matching the domain), rename the local directory first.

3. Create the **public** GitHub repo. Either via the GitHub UI, or with `gh`:
   ```bash
   gh repo create Maev4l/brigitte-leroux-website --public --source=. --remote=origin
   ```
   If you used the UI, link the remote manually:
   ```bash
   git remote add origin git@github.com:Maev4l/brigitte-leroux-website.git
   ```

4. Push:
   ```bash
   git push -u origin main
   ```

5. Verify:
   - The repo is visible at `https://github.com/Maev4l/brigitte-leroux-website`.
   - History is preserved: open any file under `packages/website/src/` on GitHub, click "History" → previous commits from before the refactor should appear (proves `git mv` worked).
   - The `README.md` renders on the repo landing page.

Once this is done, **the next plan (CI/CD via GitHub Actions, then the CMS plans) can be written and executed.**

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-05-20-content-editing-cms-design.md` §0):

| Spec requirement | Plan task |
| --- | --- |
| `git mv` Astro source tree under `packages/website/` (preserves history) | Task 2 |
| `git mv infrastructure/ packages/infrastructure/` | Task 3 |
| Adjust paths in `pull-public.sh` and `deploy.sh` | Task 4 |
| Move the Astro `package.json` into `packages/website/` unchanged | Task 2 + Task 7 |
| Create the slim root `package.json` | Task 6 |
| Update `CLAUDE.md` (drop "no workspaces", document new layout) | Task 8 |
| Verify all root scripts work | Task 9 |
| Pause for the administrator to commit + push | Tasks 10–11 |

All spec items covered.

**Out of scope for this plan** (handled in later plans):
- Creating `packages/functions/` (spec: "created later when CMS work starts").
- Adding `backend:build` / `backend:deploy` scripts and the Makefile orchestrator.
- Any AWS infrastructure changes (Cognito, API Gateway, Lambdas, SSM).
- GitHub Actions workflow.
- `check:links` at the root.
