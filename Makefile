# Root convenience targets for the monorepo. These only delegate into the
# per-package tooling (Astro site via `yarn --cwd`, Lambdas via `make -C`,
# Terraform via `-chdir`) — there is no root-level JS package, so a Makefile
# is a better fit than a package.json full of npm scripts.
#
# Target names mirror the former npm script names with `:` replaced by `-`
# (e.g. `frontend:deploy` -> `frontend-deploy`).
#
# Pass extra flags to the frontend pull via ARGS, e.g.:
#   make frontend-pull ARGS="--dry-run"
#   make frontend-pull ARGS="--delete"

ARGS ?=

.PHONY: frontend-dev frontend-build frontend-pull frontend-deploy \
        backend-build backend-deploy infra-plan infra-apply

frontend-dev:
	yarn --cwd packages/website dev

frontend-build:
	yarn --cwd packages/website build

frontend-pull:
	yarn --cwd packages/website pull $(ARGS)

frontend-deploy:
	yarn --cwd packages/website deploy

backend-build:
	$(MAKE) -C packages/functions build

# Build the Lambda bundles first, then apply the infra that references them.
backend-deploy: backend-build infra-apply

infra-plan:
	terraform -chdir=packages/infrastructure plan

infra-apply:
	terraform -chdir=packages/infrastructure apply -auto-approve
