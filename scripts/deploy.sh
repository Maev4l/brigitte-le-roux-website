#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BUCKET=$(terraform -chdir=infrastructure output -raw bucket_name)
DIST_ID=$(terraform -chdir=infrastructure output -raw cloudfront_distribution_id)

echo "==> Building"
yarn build

echo "==> Syncing dist/ to s3://$BUCKET/"
# --size-only: Astro rebuilds reset mtimes, so default mtime comparison would re-upload everything.
aws s3 sync dist/ "s3://$BUCKET/" --delete --size-only

echo "==> Invalidating CloudFront /*"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --output text > /dev/null

echo "==> Done: https://$(terraform -chdir=infrastructure output -raw cloudfront_domain)/"
