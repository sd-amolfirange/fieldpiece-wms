#!/usr/bin/env bash
# Shared by run.sh and down.sh: picks the target (local | cloud), its env file and the Compose profiles, so both
# scripts always drive the same stack.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/deploy"
TARGET="local"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
info() { printf '\033[1m==> %s\033[0m\n' "$*"; }

# Value of KEY in the env file (last one wins; quotes and CR stripped). Empty when unset.
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

is_true() { case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in true | 1 | yes) return 0 ;; *) return 1 ;; esac; }

# Sets ENV_FILE and PROFILES for $TARGET and checks the tools.
load_target() {
  case "$TARGET" in local | cloud) ;; *) die "unknown target '$TARGET' (use local or cloud)" ;; esac
  ENV_FILE="$DEPLOY/env/$TARGET.env"
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_FILE.example" ]; then
      die "missing $ENV_FILE. Copy $ENV_FILE.example to it and fill in the values."
    fi
    die "missing $ENV_FILE"
  fi
  if [ "$TARGET" = cloud ] && grep -v '^[[:space:]]*#' "$ENV_FILE" | grep -q 'change-me'; then
    die "$ENV_FILE still contains 'change-me' values. Fill them in first."
  fi
  command -v docker >/dev/null 2>&1 || die "docker isn't installed or not on PATH"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 ('docker compose') is required"
  docker info >/dev/null 2>&1 || die "the Docker daemon isn't running"

  PROFILES=()
  if is_true "$(env_value USE_BUNDLED_DB)"; then PROFILES+=(--profile db); fi
  # Relative to deploy/ (where the compose file lives): works the same from Git Bash on Windows and on Linux.
  export STACK_ENV_FILE="env/$TARGET.env"
}

# A path docker can read: Git Bash on Windows needs D:/... (its automatic conversion skips some paths, such as ones
# with an apostrophe); Linux and macOS pass paths through unchanged.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# docker compose for this target.
compose() {
  docker compose --project-directory "$(native_path "$DEPLOY")" -f "$(native_path "$DEPLOY/docker-compose.yml")" \
    --env-file "$(native_path "$ENV_FILE")" "${PROFILES[@]}" "$@"
}
