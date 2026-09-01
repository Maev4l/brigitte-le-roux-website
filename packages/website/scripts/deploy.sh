#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BUCKET=$(terraform -chdir=../infrastructure output -raw bucket_name)
DIST_ID=$(terraform -chdir=../infrastructure output -raw cloudfront_distribution_id)
# The CMS lives on a second distribution over the same bucket, so a change to
# public/cms/** is invisible until THAT one is invalidated too. Its default
# behavior uses CachingOptimized (24h TTL), which is long enough for a stale
# sign-in page to look like a failed deploy.
CMS_DIST_ID=$(terraform -chdir=../infrastructure output -raw cms_distribution_id)

echo "==> Building"
yarn build

# Two-pass sync. A single-pass `aws s3 sync --delete --size-only` had a
# subtle correctness bug: HTML files whose only change between builds was
# the embedded `/_astro/_slug_.HASH.css` filename have identical byte size,
# so --size-only skipped re-uploading them, while --delete removed the old
# CSS bundle they pointed at — leaving live pages referencing a 403
# stylesheet.

# Pass 1 (size-only): static binary assets in data/. These are large
# (~217 MB total), rarely change, and don't share byte-size with unrelated
# files. --size-only is correct + efficient here.
echo "==> Syncing static assets (size-only)"
aws s3 sync dist/data/ "s3://$BUCKET/data/" --size-only --delete

# Pass 2 (no --size-only): HTML, Astro CSS/JS bundles, sitemap, robots.
# Small files; Astro resets mtimes on every build, so default mtime+size
# comparison re-uploads them all every time — exactly what we want, since
# it guarantees HTML and the CSS bundles it references stay in sync. The
# --exclude flag keeps --delete from touching the size-only-managed prefix.
echo "==> Syncing HTML + bundles (force re-upload, no --size-only)"
aws s3 sync dist/ "s3://$BUCKET/" --delete --exclude "data/*"

for dist in "$DIST_ID" "$CMS_DIST_ID"; do
  echo "==> Invalidating CloudFront /* on $dist"
  aws cloudfront create-invalidation \
    --distribution-id "$dist" \
    --paths "/*" \
    --output text > /dev/null
done

echo "==> Done: https://$(terraform -chdir=../infrastructure output -raw cloudfront_domain)/"
