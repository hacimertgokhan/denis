#!/usr/bin/env sh
# Start the Denis server from an extracted release bundle (see bin/denis for the CLI).
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/bin/denis" server "$@"
