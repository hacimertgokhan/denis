#!/usr/bin/env bash
# End-to-end benchmark of a Denis server build.
#
#   benchmarks/run.sh [label]              build this checkout, run the matrix, compare with the latest results file
#   BENCH_SERVER_JAR=old.jar benchmarks/run.sh 0.0.2.9   measure another build with the same tool
#
# Environment: BENCH_DURATION (s, default 10), BENCH_PORT (default 6199),
# BENCH_COMPARE (results file to compare with), BENCH_QUICK=1 (3 s runs).
# Results are appended to benchmarks/results/<label>.jsonl (one JSON object per run).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BENCH="$ROOT/benchmarks"
LABEL=${1:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo local)}
DURATION=${BENCH_DURATION:-10}
WARMUP=3
if [ "${BENCH_QUICK:-0}" = "1" ]; then DURATION=3; WARMUP=1; fi
PORT=${BENCH_PORT:-6199}
RESULTS="$BENCH/results"
OUT="$RESULTS/$LABEL.jsonl"
mkdir -p "$RESULTS"

PREVIOUS=${BENCH_COMPARE:-$(ls -t "$RESULTS"/*.jsonl 2>/dev/null | grep -v "/$LABEL.jsonl$" | head -n 1 || true)}

echo "==> building"
if [ -z "${BENCH_SERVER_JAR:-}" ]; then
  (cd "$ROOT" && mvn -B -q -DskipTests clean install)
  # the exact artifact of this checkout (target/ may hold other jars)
  VERSION=$(sed -n 's:^    <version>\(.*\)</version>:\1:p' "$ROOT/pom.xml" | head -n 1)
  SERVER_JAR="$ROOT/target/denis-$VERSION.jar"
else
  SERVER_JAR=$BENCH_SERVER_JAR
fi
(cd "$BENCH" && mvn -B -q -DskipTests package)
TOOLS="$BENCH/target/denis-benchmarks.jar"

WORK=$(mktemp -d)
cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> starting $(basename "$SERVER_JAR") on port $PORT (work dir $WORK)"
(
  cd "$WORK"
  export DENIS_BOOTSTRAP_GROUP=bench DENIS_BOOTSTRAP_GROUP_PASSWORD=bench \
         DENIS_DDB_PORT=$PORT DDB_PORT=$PORT DENIS_MAX_CONNECTIONS_PER_IP=1000 \
         DENIS_PASSWORD_ITERATIONS=20000 DENIS_LANGUAGE=en DENIS_LOG_FILE=none
  exec java -Xmx2g -jar "$SERVER_JAR" server > server.log 2>&1
) &
SERVER_PID=$!
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then break; fi
  sleep 0.5
done

run() {
  java -cp "$TOOLS" github.hacimertgokhan.denis.bench.LoadGenerator --port "$PORT" \
    --duration "$DURATION" --warmup "$WARMUP" --label "$LABEL" --out "$OUT" "$@"
}

echo "==> matrix ($DURATION s per run)"
run --workload set     --connections 8  --pipeline 16
run --workload get     --connections 8  --pipeline 16
run --workload mixed   --connections 8  --pipeline 16
run --workload mixed   --connections 32 --pipeline 1
run --workload persist --connections 8  --pipeline 16 --keys 2000
run --workload persist --connections 1  --pipeline 1  --keys 2000
run --workload sql     --connections 8  --pipeline 16 --sql-rows 1000
run --workload sql-indexed --connections 8 --pipeline 16 --sql-rows 1000 || echo "   (sql-indexed needs Denis 0.1+)"

echo "==> results in $OUT"
if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS" ]; then
  echo "==> compared with $(basename "$PREVIOUS")"
  java -cp "$TOOLS" github.hacimertgokhan.denis.bench.Compare "$PREVIOUS" "$OUT"
fi
