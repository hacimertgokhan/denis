#!/usr/bin/env sh
# Run the Denis management CLI from an extracted release bundle.
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/bin/denis" cli "$@"
