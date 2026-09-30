#!/usr/bin/env bash
# Starts the whole application: database, cache, migrations, API and web app (deploy/docker-compose.yml).
# The same script runs on a laptop and on a cloud VM; only the env file differs.
#
#   ./run.sh                 local stack, built from this checkout (deploy/env/local.env)
#   ./run.sh cloud           the same stack with deploy/env/cloud.env
#   ./run.sh cloud --pull    use images already pushed to IMAGE_REGISTRY:IMAGE_TAG instead of building
#   ./run.sh cloud --push    build the images and push them to IMAGE_REGISTRY:IMAGE_TAG (CI), start nothing
#
# Options:
#   --pull       pull images instead of building them
#   --push       build and push the images, then exit (docker login to the registry first)
#   --no-build   reuse images that are already there
#   --seed       load the starting data if the database is empty (default: SEED_DEMO_DATA in the env file)
#   --no-seed    never load the starting data
#   -h, --help   this help
#
# Stop with ./down.sh (same target).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy/lib.sh"

MODE=build
SEED=""
while [ $# -gt 0 ]; do
  case "$1" in
    local | cloud) TARGET="$1" ;;
    --pull) MODE=pull ;;
    --push) MODE=push ;;
    --no-build) MODE=none ;;
    --seed) SEED=yes ;;
    --no-seed) SEED=no ;;
    -h | --help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option '$1' (see ./run.sh --help)" ;;
  esac
  shift
done

load_target
[ -n "$SEED" ] || { is_true "$(env_value SEED_DEMO_DATA)" && SEED=yes || SEED=no; }

info "Target: $TARGET ($ENV_FILE)"
case "$MODE" in
  build) info "Building images"; compose build ;;
  pull) info "Pulling images"; compose pull migrate api web $(is_true "$(env_value ASSISTANT_ENABLED)" && echo chatbot) ;;
  push)
    info "Building and pushing $(env_value IMAGE_REGISTRY)/{api,api-tools,web}:$(env_value IMAGE_TAG)"
    compose build
    compose push migrate api web $(is_true "$(env_value ASSISTANT_ENABLED)" && echo chatbot)
    info "Pushed. On the server: ./run.sh $TARGET --pull"
    exit 0
    ;;
  none) ;;
esac

info "Starting the database and cache, then migrating"
compose up -d redis $(is_true "$(env_value USE_BUNDLED_DB)" && echo postgres)
compose up --no-build --exit-code-from migrate migrate

if [ "$SEED" = yes ]; then
  info "Loading the starting data (only if the database is empty)"
  compose --profile seed run --rm --no-deps seed
fi

info "Starting the API and the web app"
compose up -d --no-build --wait --wait-timeout 300 api web
if is_true "$(env_value ASSISTANT_ENABLED)"; then
  info "Starting the Warranty Assistant (it seeds its knowledge base on start)"
  compose up -d --no-build --wait --wait-timeout 300 chatbot-db chatbot
fi

PORT="$(env_value WEB_PORT)"
info "Running. Open http://localhost:${PORT:-8088}  (stop with ./down.sh${TARGET:+ $TARGET})"
compose ps
