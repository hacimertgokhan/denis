#!/bin/sh
# Runs the Denis jar with the working directory on the data volume.
#   entrypoint.sh server            start the database (default)
#   entrypoint.sh cli group list    run any CLI command against the same data
#   entrypoint.sh backup create -g admin -p ...
set -eu
# shellcheck disable=SC2086
exec java ${JAVA_OPTS:-} -jar /app/denis.jar "$@"
