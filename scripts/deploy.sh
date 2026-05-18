#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BUCKET=$(terraform -chdir=infrastructure output -raw bucket_name)
DIST_ID=$(terraform -chdir=infrastructure output -raw cloudfront_distribution_id)

echo "==> Building"
yarn build

# Two-pass sync. A single-pass `aws s3 sync --delete --size-only` had a
# subtle correctness bug: HTML files whose only change between builds was
# the embedded `/_astro/_slug_.HASH.css` filename have identical byte size,
# so --size-only skipped re-uploading them, while --delete removed the old
# CSS bundle they pointed at — leaving live pages referencing a 403
# stylesheet.

# Pass 1 (size-only): static binary assets in data/, pdfs/, img/. These are
# large (~217 MB total), rarely change, and don't share byte-size with
# unrelated files. --size-only is correct + efficient here. --delete on
# each pass preserves the original "removed locally → removed on S3"
# behaviour for these prefixes.
echo "==> Syncing static assets (size-only)"
aws s3 sync dist/data/ "s3://$BUCKET/data/" --size-only --delete
aws s3 sync dist/pdfs/ "s3://$BUCKET/pdfs/" --size-only --delete
aws s3 sync dist/img/  "s3://$BUCKET/img/"  --size-only --delete

# Pass 2 (no --size-only): HTML, Astro CSS/JS bundles, sitemap, robots.
# Small files; Astro resets mtimes on every build, so default mtime+size
# comparison re-uploads them all every time — exactly what we want, since
# it guarantees HTML and the CSS bundles it references stay in sync. The
# --exclude flags keep --delete from touching the size-only-managed dirs.
echo "==> Syncing HTML + bundles (force re-upload, no --size-only)"
aws s3 sync dist/ "s3://$BUCKET/" --delete \
  --exclude "data/*" --exclude "pdfs/*" --exclude "img/*"

echo "==> Invalidating CloudFront /*"
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --output text > /dev/null

echo "==> Done: https://$(terraform -chdir=infrastructure output -raw cloudfront_domain)/"
