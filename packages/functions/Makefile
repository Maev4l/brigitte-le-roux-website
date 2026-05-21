# Orchestrates esbuild bundling + ZIP packaging for every Lambda function
# in this monorepo. Each subdirectory that contains a package.json is
# treated as a function:
#
#   1. yarn install --frozen-lockfile  (gets esbuild + deps)
#   2. yarn build                       (esbuild → dist/index.mjs)
#   3. zip dist/<name>.zip with index.mjs at the ZIP root
#
# Lambda's runtime then sees a single index.mjs file and the handler
# resolves as `index.handler`.

FUNCTIONS := $(notdir $(patsubst %/package.json,%,$(wildcard */package.json)))

.PHONY: build clean

build:
	@set -e; for fn in $(FUNCTIONS); do \
		echo "→ Building $$fn"; \
		( cd $$fn && yarn install --frozen-lockfile >/dev/null && yarn build >/dev/null ); \
		( cd $$fn/dist && rm -f $$fn.zip && zip -q $$fn.zip index.mjs ); \
		echo "✓ packages/functions/$$fn/dist/$$fn.zip ($$(du -h $$fn/dist/$$fn.zip | cut -f1))"; \
	done

clean:
	@rm -rf */dist
	@echo "✓ cleaned"
