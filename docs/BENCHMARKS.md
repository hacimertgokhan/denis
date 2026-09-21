# Benchmarks: Denis vs Redis and PostgreSQL

Measured on 21 September 2026 with the harness in [`bench/`](../bench) against
Denis 0.3.1, **Redis 7.4** (`appendonly yes`, `appendfsync everysec`) and
**PostgreSQL 16** (primary key on `id`, parameterised queries). Every system
ran in Docker Desktop (WSL 2) on the same machine with **2 CPUs / 1 GB** per
container; the load generator was one Node.js 22 process on the host
(i9-13900K, 64 GB). Numbers are meaningful relative to each other, not as
absolute figures: every request crosses the VM boundary, which alone costs
about 0.3 ms.

The Denis Node client pipelines commands (several in flight per connection),
exactly like the Redis client; Denis used `poolSize = concurrency` connections,
Redis one multiplexed connection, PostgreSQL a pool of `concurrency`.

## Summary: who wins where

| Area | Winner | Notes |
| --- | --- | --- |
| Single-client latency (KV) | **tie** | ~0.3 ms p50 for both Denis and Redis; the network path dominates |
| Throughput at 16-64 clients (KV) | **Redis** | Redis ~120-150k ops/s, Denis ~50-65k (40-60 % of Redis); Denis is a thread-per-connection JVM server, Redis an event loop in C |
| Large values (16-64 KB) | **tie** | within +/-10 %; Denis slightly better on reads |
| `MGET` (10 keys) | near tie | Denis reaches 80 % of Redis at 64 clients |
| `KEYS pattern` over 60k keys | Redis | 3x faster; both are full scans |
| Persisted writes | **tie (throughput)** | Denis's 1 s write-behind costs nothing on the request path, like Redis AOF everysec |
| Durability on `SIGKILL` | Redis | Redis lost 0 of 10,047 acknowledged writes, Denis lost 443 of 9,162 (the last ~0.15 s): Denis keeps dirty data in the JVM heap until the next flush, Redis hands every write to the kernel immediately (the page cache survives a process kill) |
| Durability on graceful restart | tie | Denis 5,000 / 5,000 keys survived |
| Memory (100k x 100 B keys) | Redis | Redis 25 MB, PostgreSQL 49 MB, Denis 230 MB RSS (JVM + cache + persisted copy); `database.bin` is 19 MB |
| SQL inserts | **Denis** (12x PostgreSQL) | Denis appends a JSON row to a hash map and flushes every second; PostgreSQL commits with WAL + fsync per statement: different guarantees |
| SQL reads (`SELECT ... WHERE id`, `COUNT`, `ORDER BY ... LIMIT`) | **PostgreSQL** (40-300x) | Denis has no indexes: every statement scans and parses every row (19 ms per query on 10k rows, 90 ms on 50k) |
| SQL updates / deletes | PostgreSQL (5-45x) | same full scan, plus a per-table lock |
| SQL under concurrency | PostgreSQL | Denis stays at ~55 statements/s whatever the concurrency; PostgreSQL scales to 16k point queries/s |

**Bottom line.** As a key-value cache Denis is in Redis's league for latency
and for large values, and reaches roughly half of Redis's throughput under
heavy concurrency; it needs an append-only log to match Redis's crash
durability. Its SQL layer is fine for small tables (hundreds to a few thousand
rows: 3 ms per query at 1k rows) and for write-heavy logging, but it is not a
substitute for a relational database on tables of 10k+ rows: the engine has
no indexes and no query planner.

## Key-value operations (Denis vs Redis 7)

| Workload | Conc. | Denis ops/s | Redis ops/s | Denis p50 / p99 ms | Redis p50 / p99 ms | Denis vs Redis |
| --- | --: | --: | --: | --: | --: | --: |
| set (cache only) | 1 | 3,208 | 3,144 | 0.301 / 0.52 | 0.307 / 0.576 | 102 % |
| set persisted | 1 | 3,255 | 3,393 | 0.287 / 0.579 | 0.277 / 0.558 | 96 % |
| get hit | 1 | 3,209 | 3,213 | 0.297 / 0.556 | 0.294 / 0.584 | 100 % |
| get miss | 1 | 3,401 | 3,367 | 0.278 / 0.531 | 0.284 / 0.529 | 101 % |
| exists | 1 | 3,328 | 3,359 | 0.289 / 0.489 | 0.287 / 0.493 | 99 % |
| mget 10 keys | 1 | 2,840 | 3,025 | 0.336 / 0.607 | 0.321 / 0.526 | 94 % |
| delete | 1 | 3,213 | 3,032 | 0.299 / 0.552 | 0.317 / 0.569 | 106 % |
| set (cache only) | 16 | 23,021 | 37,340 | 0.601 / 1.788 | 0.407 / 0.744 | 62 % |
| set persisted | 16 | 24,403 | 40,676 | 0.559 / 1.537 | 0.381 / 0.655 | 60 % |
| get hit | 16 | 27,886 | 46,146 | 0.522 / 1.474 | 0.336 / 0.562 | 60 % |
| get miss | 16 | 23,660 | 45,143 | 0.563 / 1.971 | 0.339 / 0.609 | 52 % |
| exists | 16 | 23,288 | 51,274 | 0.58 / 1.913 | 0.3 / 0.552 | 45 % |
| mget 10 keys | 16 | 16,803 | 23,994 | 0.867 / 1.98 | 0.633 / 1.182 | 70 % |
| delete | 16 | 22,303 | 44,192 | 0.628 / 1.875 | 0.342 / 0.774 | 50 % |
| set (cache only) | 64 | 64,656 | 123,361 | 0.858 / 2.277 | 0.494 / 0.877 | 52 % |
| set persisted | 64 | 50,255 | 98,347 | 1.027 / 4.23 | 0.611 / 1.355 | 51 % |
| get hit | 64 | 51,912 | 121,432 | 1.066 / 3.701 | 0.505 / 0.912 | 43 % |
| get miss | 64 | 62,441 | 150,809 | 0.939 / 2.153 | 0.41 / 0.705 | 41 % |
| exists | 64 | 51,283 | 133,548 | 1.03 / 4.4 | 0.439 / 0.993 | 38 % |
| mget 10 keys | 64 | 39,377 | 49,201 | 1.42 / 4.115 | 1.293 / 1.636 | 80 % |
| delete | 64 | 58,702 | 126,817 | 0.989 / 2.534 | 0.473 / 1.104 | 46 % |
| keys pattern (~60k keys) | 1 | 190 | 608 | 5.141 / 7.045 | 1.559 / 2.743 | 31 % |

### Value sizes (concurrency 16)

| Workload | Denis ops/s | Redis ops/s | Denis p50 / p99 ms | Redis p50 / p99 ms | Denis vs Redis |
| --- | --: | --: | --: | --: | --: |
| set 1 KB value | 26,673 | 30,451 | 0.547 / 1.434 | 0.495 / 1.107 | 88 % |
| get 1 KB value | 20,639 | 36,949 | 0.639 / 2.068 | 0.417 / 0.874 | 56 % |
| set 16 KB value | 11,367 | 15,846 | 1.142 / 9.857 | 0.881 / 2.054 | 72 % |
| get 16 KB value | 13,413 | 12,174 | 1.028 / 2.519 | 0.755 / 14.892 | 110 % |
| set 64 KB value | 3,802 | 4,323 | 3.145 / 21.914 | 3.092 / 23.304 | 88 % |
| get 64 KB value | 4,608 | 4,094 | 3.29 / 9.836 | 3.483 / 7.255 | 113 % |

### Bulk load and memory (100k keys x 100 B, concurrency 32)

| | Denis | Redis | PostgreSQL |
| --- | --: | --: | --: |
| load throughput | 28,190 ops/s (persisted) | 62,979 ops/s | - |
| container RSS after load | 229.5 MiB | 25.4 MiB | 49.2 MiB (idle, 10k-row table) |
| on-disk size | `database.bin` 19.4 MB | AOF | - |

## Durability

| Check | Denis | Redis (AOF everysec) |
| --- | --- | --- |
| graceful restart (`docker restart`), 5,000 persisted keys | 5,000 / 5,000 survived | - |
| `docker kill -s KILL` after 3 s of continuous persisted writes | 8,719 / 9,162 acknowledged writes survived (443 lost, about the last 0.15 s) | 10,047 / 10,047 survived |

Denis acknowledges a persisted `SET` once it is in memory and writes the
whole `database.bin` atomically every `persist-flush-interval-ms` (1 s); a
process kill loses what was written since the last flush (a power loss would
lose the same for Redis with `everysec`). Setting the interval to `0` makes
every write synchronous and rewrites the file each time, which is only
practical for small stores. An append-only journal is the natural next step.

## SQL on a 10k-row table (Denis vs PostgreSQL 16)

| Workload | Conc. | Denis ops/s | PostgreSQL ops/s | Denis p50 / p99 ms | PostgreSQL p50 / p99 ms | Denis vs PostgreSQL |
| --- | --: | --: | --: | --: | --: | --: |
| insert 1 row | 1 | 2,769 | 237 | 0.352 / 0.533 | 3.468 / 15.47 | 11.7x faster |
| insert 500-row batch | 1 | 316 | 218 | 2.91 / 4.924 | 4.086 / 7.473 | 1.4x faster |
| select by id | 1 | 52 | 2,238 | 19.12 / 23.555 | 0.431 / 0.668 | 2 % |
| select range + order by + limit 20 | 1 | 38 | 1,168 | 25.674 / 32.864 | 0.814 / 1.031 | 3 % |
| count(*) | 1 | 55 | 1,720 | 17.85 / 21.747 | 0.525 / 1.363 | 3 % |
| update by id | 1 | 52 | 238 | 19.041 / 22.852 | 3.542 / 15.024 | 22 % |
| delete by id | 1 | 54 | 271 | 18.371 / 22.717 | 3.481 / 14.859 | 20 % |
| insert 1 row | 16 | 25,948 | 2,084 | 0.585 / 1.207 | 5.874 / 18.815 | 12.5x faster |
| select by id | 16 | 53 | 16,399 | 267.77 / 596.893 | 0.69 / 10.461 | 0.3 % |
| select range + order by + limit 20 | 16 | 38 | 3,943 | 402.917 / 1667.706 | 1.6 / 63.77 | 1 % |
| count(*) | 16 | 59 | 17,272 | 207.365 / 1758.252 | 0.868 / 1.776 | 0.3 % |
| update by id | 16 | 54 | 1,389 | 261.251 / 772.215 | 10.963 / 19.014 | 4 % |
| delete by id | 16 | 56 | 2,490 | 256.006 / 683.599 | 5.884 / 14.045 | 2 % |

### Scaling with table size (concurrency 1)

| Rows | Denis select by id | PostgreSQL select by id | Denis count(*) | PostgreSQL count(*) |
| --: | --: | --: | --: | --: |
| 1,000 | 3.1 ms (311/s) | 0.40 ms (2,463/s) | 3.3 ms | 0.36 ms |
| 10,000 | 19.2 ms (51/s) | 0.40 ms (2,453/s) | 18.0 ms | 0.54 ms |
| 50,000 | 91.0 ms (10/s) | 0.41 ms (2,396/s) | 82.8 ms | 1.32 ms |

Denis's cost grows linearly with the table (about 1.8 us per row: every row
is a JSON document that is parsed for every statement) while PostgreSQL's
point query is flat thanks to the index. Inserts look 12x faster only because
Denis does no indexing, no WAL and no fsync per statement.

## What the benchmark changed in Denis

- Running it exposed that the server served at most **4 concurrent
  connections** (`ThreadPoolExecutor` with an unbounded queue); fixed in 0.3.1.
- The Node client gained **pipelining**, which took Denis from ~7k to ~60k
  ops/s at 64 clients.

## Where Denis could improve next

1. **Append-only journal** for persisted writes (crash durability like Redis
   AOF, and no full-file rewrite).
2. **Indexes for the SQL engine** (at least a hash index on equality columns,
   and rows kept as parsed objects instead of JSON text): this is the 40-300x gap.
3. **Non-blocking I/O** (NIO or virtual threads on Java 21) to close the
   throughput gap with Redis under many connections.
4. Lower memory per key (the cache stores `Any` wrappers and a second copy in
   the persisted map).

## Reproduce

```sh
cd bench && npm install
docker compose -f compose.bench.yaml up -d --wait
node run.js            # ~15 minutes; prints Markdown, writes results.json
```
