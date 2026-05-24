#!/usr/bin/env bash
set -euo pipefail

# Sync the canonical binary content (PDFs, data files, photos) from the
# production S3 bucket into local public/data/.
#
# Direction: S3 → local. To push local → S3, use `yarn deploy`.
#
# Multi-writer workflow:
#   1. `bash scripts/pull-public.sh`  — pull any changes since your last sync
#   2. Edit files in public/data/ locally as needed
#   3. `yarn deploy`                  — build + push public/ + invalidate CDN
#
# Always pull before editing. The script uses `aws s3 sync`'s default mtime
# comparison (S3 LastModified vs local mtime), so concurrent writers' updates
# are pulled on the next sync without overwriting unchanged local files.
#
# Usage:
#   bash scripts/pull-public.sh                # pull data/ from S3
#   bash scripts/pull-public.sh --dry-run      # preview without writing
#   bash scripts/pull-public.sh --delete       # also remove local files absent from S3

cd "$(dirname "$0")/.."

BUCKET=$(terraform -chdir=../infrastructure output -raw bucket_name)

EXTRA=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) EXTRA+=(--dryrun) ;;
    --delete)     EXTRA+=(--delete) ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--dry-run] [--delete]" >&2
      exit 2
      ;;
  esac
done

mkdir -p public/data

echo "==> Syncing s3://$BUCKET/data/ → public/data/"
# ${EXTRA[@]+"${EXTRA[@]}"} (alternative-value expansion) — without the
# `[@]+…` guard, an empty EXTRA array trips `set -u` on Bash 3.2 (the
# macOS default), aborting the no-flags `yarn pull` invocation.
aws s3 sync ${EXTRA[@]+"${EXTRA[@]}"} "s3://$BUCKET/data/" "public/data/"

echo "==> Done"
