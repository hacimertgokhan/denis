# Denis benchmarks

Reproducible measurements of Denis against **Redis 7** (key-value) and
**PostgreSQL 16** (the SQL subset), all three in Docker with the same CPU and
memory limits, driven by one Node.js process on the same host. The latest
results and their interpretation are in [`../docs/BENCHMARKS.md`](../docs/BENCHMARKS.md).

```sh
cd bench && npm install
docker compose -f compose.bench.yaml up -d --wait     # denis:local, redis:7-alpine, postgres:16-alpine
node run.js                                           # all suites, ~10-15 minutes
node run.js kv sql                                    # a subset: kv, sql, scale, durability, memory
docker compose -f compose.bench.yaml down -v
```

`run.js` prints a Markdown table to stdout, progress to stderr, and writes
`results.json`. `OPS` (default 20000) scales the key-value suites.

## What is measured

| Suite | Workloads |
| --- | --- |
| `kv` | SET (cache only / persisted), GET hit/miss, EXISTS, MGET×10, DEL at concurrency 1, 16, 64; 1 KB / 16 KB / 64 KB values; `KEYS pattern` over ~60k keys — Denis vs Redis (`appendonly yes`, `appendfsync everysec`, the closest match to Denis's 1 s write-behind flush) |
| `sql` | single-row INSERT, 500-row batch INSERT, point SELECT, range+ORDER BY+LIMIT, COUNT(*), UPDATE and DELETE by id on a 10k-row table at concurrency 1 and 16 — Denis vs PostgreSQL (primary key index, parameterised queries) |
| `scale` | point SELECT and COUNT(*) latency at 1k, 10k and 50k rows — shows Denis's full-scan engine vs an indexed table |
| `durability` | 5000 persisted keys across a graceful restart; `docker kill -s KILL` while writing, for Denis (flush every 1 s) and Redis (AOF everysec) |
| `memory` | container RSS and `database.bin` size after loading 100k keys × 100 bytes |

Latency is measured per operation from the client (p50/p95/p99/max in ms);
throughput is operations per wall-clock second at the given concurrency. The
Denis client pipelines commands (several in flight per connection) exactly like
the Redis client does.

## Fairness notes

- Same host, Docker Desktop on Windows: every request crosses the VM boundary,
  so single-connection latency (~0.3 ms) is dominated by the network path for
  every system. Compare the systems with each other, not with published
  bare-metal numbers.
- Redis is single-threaded C with an event loop; Denis is a thread-per-connection
  Java server. PostgreSQL is a full RDBMS with an index on `id`; Denis's SQL
  engine scans every row of the table for every statement.
- Each container gets 2 CPUs and 1 GB. Nothing else is tuned.
