# Benchmarks: Denis vs Redis and PostgreSQL

Measured on 21 September 2026 with the harness in [`bench/`](../bench) against
**Denis 0.4.0**, **Redis 7.4** (`appendonly yes`, `appendfsync everysec`) and
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
| Throughput at 16-64 clients (KV) | **Redis** | Redis ~115-155k ops/s, Denis ~45-68k (40-55 % of Redis); Denis is a thread-per-connection JVM server, Redis an event loop in C |
| Large values (16-64 KB) | **tie** | within +/-15 % |
| `MGET` (10 keys) | near tie | Denis reaches ~80 % of Redis |
| `KEYS pattern` over 60k keys | Redis | ~3x faster; both are full scans |
| Persisted writes | **tie** | Denis's journal costs nothing visible on the request path (61.8k vs 115.6k ops/s at 64 clients, the same ratio as cache-only writes) |
| Durability on `SIGKILL` | **tie** | Denis 9,079 / 9,079 and Redis 9,968 / 9,968 acknowledged writes survived: both hand every write to the kernel at once and fsync every second |
| Durability on graceful restart | tie | Denis 5,000 / 5,000 keys survived |
| Memory (100k x 100 B keys) | Redis | Redis 26 MB, PostgreSQL 47 MB, Denis 212 MB RSS (JVM heap + cache + persisted copy); `database.bin` is 19 MB |
| SQL point reads (`WHERE id = ...`), `COUNT(*)` | **Denis** | index lookup: 2.8k ops/s single client (PostgreSQL 2.3k), 20k at 16 clients (PostgreSQL 17k); `COUNT(*)` is O(1) |
| SQL inserts / updates / deletes by id | **Denis** (4-10x) | in-memory rows + journal vs WAL + fsync per statement: different guarantees (see Durability) |
| SQL range scans with `ORDER BY` | **PostgreSQL** (3-5x) | Denis scans and sorts the table in memory (2.4 ms on 10k rows); no ordered index yet |
| SQL scaling to 50k rows | **Denis / tie** | point query and `COUNT(*)` stay at ~0.3 ms whatever the size; PostgreSQL's `COUNT(*)` grows to 1.3 ms |

**Bottom line.** As a key-value store Denis matches Redis on latency, large
values and crash durability, and delivers roughly half of Redis's throughput
under heavy concurrency. Its SQL layer is now an in-memory table store with
hash indexes: point lookups, counts and writes by key are faster than
PostgreSQL in this setup; range queries with sorting are the remaining gap,
and there are still no joins, aggregates beyond `COUNT(*)` or transactions.

## 0.3.1 → 0.4.0

The 0.3.1 benchmark listed three improvements; 0.4.0 shipped them and this is
what they changed (same hardware, same harness):

| Workload | Conc. | 0.3.1 ops/s | 0.4.0 ops/s | Gain | PostgreSQL ops/s |
| --- | --: | --: | --: | --: | --: |
| select by id (10k rows) | 1 | 52 | 2,848 | 55x | 2,276 |
| select by id (10k rows) | 16 | 53 | 20,016 | 378x | 16,916 |
| count(*) | 1 | 55 | 3,095 | 56x | 1,826 |
| update by id | 1 | 52 | 2,683 | 52x | 261 |
| update by id | 16 | 54 | 16,801 | 311x | 3,990 |
| delete by id | 16 | 56 | 26,567 | 474x | 4,026 |
| select range+order+limit 20 | 1 | 38 | 398 | 10x | 1,216 |
| select by id @ 50000 rows | 1 | 10 | 3,052 | 305x | 2,536 |
| count(*) @ 50000 rows | 1 | 10 | 3,159 | 316x | 771 |


- **In-memory tables with a hash index on every column** (`Table`,
  `TableCatalog`): rows are parsed once and kept; `WHERE col = value` is a
  lookup; `COUNT(*)` is O(1). Range queries still scan (in memory, ~10x faster
  than before) and sort.
- **Append-only journal**: every persisted change is written to
  `database.journal` at once and fsynced every second; snapshots every 30 s.
  `SIGKILL` losses went from 443 writes to 0 and persisted-write throughput
  went up (no more 1-per-second full-file rewrites under load).
- **Reply batching** for pipelined clients (one flush per burst of commands).

### Key-value operations (Denis 0.4.0 vs Redis 7)

| Workload | Conc. | Denis ops/s | Redis ops/s | Denis p50 / p99 ms | Redis p50 / p99 ms | Denis vs Redis |
| --- | --: | --: | --: | --: | --: | --: |
| set (cache only) | 1 | 3,256 | 3,289 | 0.296 / 0.487 | 0.289 / 0.525 | 99 % |
| set persisted | 1 | 3,310 | 3,412 | 0.285 / 0.485 | 0.28 / 0.489 | 97 % |
| get hit | 1 | 3,401 | 3,407 | 0.281 / 0.482 | 0.283 / 0.481 | 100 % |
| get miss | 1 | 3,279 | 3,304 | 0.29 / 0.558 | 0.292 / 0.532 | 99 % |
| exists | 1 | 3,397 | 3,504 | 0.284 / 0.459 | 0.274 / 0.493 | 97 % |
| mget 10 keys | 1 | 2,946 | 3,246 | 0.329 / 0.509 | 0.302 / 0.464 | 91 % |
| delete | 1 | 3,553 | 3,558 | 0.272 / 0.456 | 0.27 / 0.496 | 100 % |
| set (cache only) | 16 | 29,494 | 41,626 | 0.49 / 1.195 | 0.362 / 0.641 | 71 % |
| set persisted | 16 | 28,899 | 44,026 | 0.5 / 1.411 | 0.347 / 0.596 | 66 % |
| get hit | 16 | 25,749 | 46,705 | 0.517 / 2.136 | 0.331 / 0.574 | 55 % |
| get miss | 16 | 20,337 | 49,938 | 0.651 / 2.169 | 0.3 / 0.645 | 41 % |
| exists | 16 | 30,386 | 46,781 | 0.487 / 1.294 | 0.327 / 0.596 | 65 % |
| mget 10 keys | 16 | 28,250 | 31,870 | 0.525 / 1.379 | 0.48 / 0.92 | 89 % |
| delete | 16 | 29,348 | 46,810 | 0.5 / 1.459 | 0.325 / 0.537 | 63 % |
| set (cache only) | 64 | 55,911 | 118,747 | 0.854 / 4.313 | 0.503 / 0.879 | 47 % |
| set persisted | 64 | 61,769 | 115,613 | 0.91 / 3.856 | 0.534 / 0.814 | 53 % |
| get hit | 64 | 43,839 | 117,445 | 1.051 / 5.942 | 0.505 / 1.143 | 37 % |
| get miss | 64 | 67,819 | 153,883 | 0.893 / 1.782 | 0.401 / 0.73 | 44 % |
| exists | 64 | 66,479 | 152,438 | 0.909 / 1.768 | 0.399 / 0.69 | 44 % |
| mget 10 keys | 64 | 43,152 | 55,605 | 1.376 / 3.267 | 0.986 / 1.919 | 78 % |
| delete | 64 | 57,367 | 126,640 | 0.963 / 3.455 | 0.448 / 0.96 | 45 % |
| keys pattern (~60k keys) | 1 | 188 | 621 | 4.88 / 11.891 | 1.558 / 2.704 | 30 % |

### Value sizes (concurrency 16)

| Workload | Conc. | Denis ops/s | Redis ops/s | Denis p50 / p99 ms | Redis p50 / p99 ms | Denis vs Redis |
| --- | --: | --: | --: | --: | --: | --: |
| set 1 KB value | 16 | 27,368 | 34,260 | 0.529 / 1.498 | 0.456 / 0.871 | 80 % |
| get 1 KB value | 16 | 26,670 | 32,087 | 0.513 / 1.431 | 0.453 / 1.083 | 83 % |
| set 16 KB value | 16 | 11,285 | 16,534 | 1.245 / 4.355 | 0.9 / 1.925 | 68 % |
| get 16 KB value | 16 | 13,637 | 16,525 | 0.998 / 2.81 | 0.774 / 2.912 | 83 % |
| set 64 KB value | 16 | 4,125 | 3,402 | 2.971 / 29.834 | 3.085 / 25.269 | 1.2x faster |
| get 64 KB value | 16 | 4,456 | 3,925 | 3.426 / 7.466 | 4.014 / 6.762 | 1.1x faster |

### SQL on a 10k-row table (Denis 0.4.0 vs PostgreSQL 16)

| Workload | Conc. | Denis ops/s | PostgreSQL ops/s | Denis p50 / p99 ms | PostgreSQL p50 / p99 ms | Denis vs PostgreSQL |
| --- | --: | --: | --: | --: | --: | --: |
| insert 1 row | 1 | 2,432 | 362 | 0.385 / 0.69 | 2.384 / 7.678 | 6.7x faster |
| insert 500-row batch | 1 | 131 | 155 | 7.042 / 21.375 | 7.181 / 11.303 | 85 % |
| select by id (10k rows) | 1 | 2,848 | 2,276 | 0.336 / 0.545 | 0.423 / 0.638 | 1.3x faster |
| select range+order+limit 20 | 1 | 398 | 1,216 | 2.429 / 3.519 | 0.81 / 1.004 | 33 % |
| count(*) | 1 | 3,095 | 1,826 | 0.309 / 0.527 | 0.535 / 0.764 | 1.7x faster |
| update by id | 1 | 2,683 | 261 | 0.358 / 0.633 | 2.564 / 8.771 | 10.3x faster |
| delete by id | 1 | 2,891 | 335 | 0.33 / 0.729 | 2.353 / 7.86 | 8.6x faster |
| insert 1 row | 16 | 15,527 | 3,914 | 0.673 / 10.434 | 3.982 / 7.36 | 4.0x faster |
| select by id (10k rows) | 16 | 20,016 | 16,916 | 0.676 / 3.982 | 0.736 / 2.064 | 1.2x faster |
| select range+order+limit 20 | 16 | 504 | 2,401 | 32.999 / 42.163 | 1.7 / 78.675 | 21 % |
| count(*) | 16 | 26,407 | 13,101 | 0.575 / 0.972 | 1.208 / 2.096 | 2.0x faster |
| update by id | 16 | 16,801 | 3,990 | 0.832 / 5.58 | 3.95 / 5.652 | 4.2x faster |
| delete by id | 16 | 26,567 | 4,026 | 0.528 / 1.989 | 3.906 / 4.737 | 6.6x faster |

### SQL scaling with table size (concurrency 1)

| Workload | Conc. | Denis ops/s | PostgreSQL ops/s | Denis p50 / p99 ms | PostgreSQL p50 / p99 ms | Denis vs PostgreSQL |
| --- | --: | --: | --: | --: | --: | --: |
| select by id @ 1000 rows | 1 | 2,988 | 2,449 | 0.326 / 0.486 | 0.4 / 0.577 | 1.2x faster |
| count(*) @ 1000 rows | 1 | 3,114 | 1,972 | 0.305 / 0.581 | 0.423 / 1.719 | 1.6x faster |
| select by id @ 10000 rows | 1 | 3,299 | 2,482 | 0.301 / 0.412 | 0.398 / 0.552 | 1.3x faster |
| count(*) @ 10000 rows | 1 | 3,284 | 1,833 | 0.3 / 0.41 | 0.545 / 0.674 | 1.8x faster |
| select by id @ 50000 rows | 1 | 3,052 | 2,536 | 0.315 / 0.626 | 0.382 / 0.7 | 1.2x faster |
| count(*) @ 50000 rows | 1 | 3,159 | 771 | 0.315 / 0.415 | 1.288 / 1.694 | 4.1x faster |

### Bulk load (100k keys x 100 B, concurrency 32)

| Workload | Conc. | Denis ops/s | Redis ops/s | Denis p50 / p99 ms | Redis p50 / p99 ms | Denis vs Redis |
| --- | --: | --: | --: | --: | --: | --: |
| load 100k keys (100 B) | 32 | 27,378 | 70,611 | 0.983 / 4.371 | 0.431 / 0.811 | 39 % |

## Durability

| Check | Denis 0.4.0 | Redis (AOF everysec) |
| --- | --- | --- |
| graceful restart (`docker restart`), 5,000 persisted keys | 5,000 / 5,000 survived | - |
| `docker kill -s KILL` after 3 s of continuous persisted writes | 9,079 / 9,079 acknowledged writes survived | 9,968 / 9,968 survived |

Both systems acknowledge a write once it is in memory and handed to the
kernel (Denis: appended to `database.journal`; Redis: appended to the AOF
buffer written every event loop) and `fsync` once a second, so a killed
process loses nothing and a power loss loses at most one second. Denis 0.3.1
kept dirty data in the JVM heap until the next snapshot and lost the last
~0.15 s of writes in the same test.

## Memory (100k keys x 100 B)

| | Denis | Redis | PostgreSQL |
| --- | --: | --: | --: |
| container RSS after load | 212.4 MiB | 26.4 MiB | 47.4 MiB (idle, 10k-row table) |
| on-disk size | `database.bin` 18.8 MB (+ journal since the last snapshot) | AOF | - |

The JVM keeps the cache entry, the persisted copy and object headers per key;
the Redis process stores each key once, compactly. Lowering this (one copy,
no `Any` wrapper, off-heap values) is the remaining item on the list.

## Where Denis could improve next

1. **Ordered index** (a `TreeMap` per column) so `WHERE price > x ORDER BY price
   LIMIT n` stops scanning and sorting the whole table.
2. **Non-blocking I/O** (NIO or virtual threads on Java 21) to close the
   throughput gap with Redis under many connections.
3. Lower memory per key.

## Reproduce

```sh
cd bench && npm install
docker compose -f compose.bench.yaml up -d --wait
node run.js            # ~15 minutes; prints Markdown, writes results.json
```
