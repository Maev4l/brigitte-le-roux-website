#!/usr/bin/env bash
set -euo pipefail

# Check that every internal link in the built site resolves with HTTP 200
# against the deployed URL.
#
# Usage: bash scripts/check-links.sh
# Override the target with: SITE=https://staging.example.com bash scripts/check-links.sh
#
# Requires a fresh `dist/` (runs `yarn build` if absent).

cd "$(dirname "$0")/.."

SITE="${SITE:-https://brigitte-le-roux.com}"
DIST="dist"

if [ ! -d "$DIST" ]; then
  echo "==> No $DIST/ found — running yarn build" >&2
  yarn build
fi

# Pull every href="/..." or src="/..." value out of the built HTML, strip the
# attribute wrapping, drop fragments and querystrings, skip protocol-relative
# URLs (//cdn.example.com/...), and dedupe.
HREFS=$(
  find "$DIST" -type f -name '*.html' -print0 \
    | xargs -0 grep -hoE '(href|src)="/[^"]*"' \
    | sed -E 's/^(href|src)="//; s/"$//; s/[#?].*$//' \
    | grep -v '^//' \
    | grep -v '^$' \
    | sort -u
)

TOTAL=$(printf '%s\n' "$HREFS" | grep -c .)
echo "==> Checking $TOTAL unique internal URLs against $SITE"

FAIL=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  # Encode raw spaces defensively; the built HTML usually already escapes them.
  encoded=${path// /%20}
  code=$(curl -sS -o /dev/null -w '%{http_code}' -I --max-time 10 "$SITE$encoded" || echo "ERR")
  if [ "$code" != "200" ]; then
    echo "  ✗ $code  $path"
    FAIL=$((FAIL + 1))
  fi
done <<< "$HREFS"

if [ "$FAIL" -gt 0 ]; then
  echo "==> $FAIL broken link(s) out of $TOTAL"
  exit 1
fi
echo "==> All $TOTAL internal links return 200"
