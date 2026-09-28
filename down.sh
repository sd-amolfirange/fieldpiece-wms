#!/usr/bin/env bash
# Stops the application started by ./run.sh. Data (database, uploads) is kept unless you pass --purge.
#
#   ./down.sh                    stop the local stack
#   ./down.sh cloud              stop the cloud stack (deploy/env/cloud.env)
#   ./down.sh --purge            also delete the data volumes (asks first)
#   ./down.sh cloud --purge --yes  delete without asking (automation)
#
# Options:
#   --purge      delete the database, cache and uploads volumes too
#   --yes        don't ask before --purge
#   -h, --help   this help
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy/lib.sh"

PURGE=no
YES=no
while [ $# -gt 0 ]; do
  case "$1" in
    local | cloud) TARGET="$1" ;;
    --purge) PURGE=yes ;;
    --yes | -y) YES=yes ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option '$1' (see ./down.sh --help)" ;;
  esac
  shift
done

load_target
info "Target: $TARGET ($ENV_FILE)"

if [ "$PURGE" = yes ]; then
  if [ "$YES" != yes ]; then
    [ -t 0 ] || die "--purge deletes all data; add --yes to confirm when running without a terminal"
    printf 'This deletes the %s database, cache and uploaded files. Type "delete" to continue: ' "$TARGET"
    read -r answer
    [ "$answer" = delete ] || die "cancelled; nothing was stopped"
  fi
  info "Stopping and deleting data volumes"
  compose --profile seed down --remove-orphans --volumes
else
  info "Stopping (data is kept)"
  compose --profile seed down --remove-orphans
fi
info "Stopped."
