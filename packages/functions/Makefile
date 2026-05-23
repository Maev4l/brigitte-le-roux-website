# Orchestrates esbuild bundling + ZIP packaging for every Lambda
# function in this monorepo. Each subdirectory that contains a
# package.json is treated as a function:
#
#   1. yarn install --frozen-lockfile  (gets esbuild + deps)
#   2. yarn build                       (esbuild → dist/index.mjs)
#   3. zip dist/<name>.zip with index.mjs at the ZIP root
#   4. If <function>/run.sh exists (LWA-based handlers), append it to
#      the ZIP. Lambda's handler value becomes run.sh; LWA's exec
#      wrapper runs it on cold init.
#
# Lambda's runtime sees `index.mjs` (event-handler functions) OR
# `run.sh` + `index.mjs` (LWA-based functions), depending on which
# files the ZIP contains.

FUNCTIONS := $(notdir $(patsubst %/package.json,%,$(wildcard */package.json)))

.PHONY: build clean

build:
	@set -e; for fn in $(FUNCTIONS); do \
		echo "→ Building $$fn"; \
		( cd $$fn && yarn install --frozen-lockfile >/dev/null && yarn build >/dev/null ); \
		( cd $$fn/dist && rm -f $$fn.zip && zip -q $$fn.zip index.mjs ); \
		if [ -f $$fn/run.sh ]; then \
			( cd $$fn && zip -qj dist/$$fn.zip run.sh ); \
			echo "  (LWA handler — appended run.sh)"; \
		fi; \
		echo "✓ packages/functions/$$fn/dist/$$fn.zip ($$(du -h $$fn/dist/$$fn.zip | cut -f1))"; \
	done

clean:
	@rm -rf */dist
	@echo "✓ cleaned"
