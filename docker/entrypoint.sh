#!/usr/bin/env bash
# Runs the Denis jar with the working directory on the data volume.
#   entrypoint.sh server            start the database (default)
#   entrypoint.sh cli group list    run any CLI command against the same data
set -euo pipefail
exec java ${JAVA_OPTS:-} -jar /app/denis.jar "$@"
