# Benchmarks

Performance work on Denis follows one rule: **measure before and after, with
the same tool, on the same machine, and keep a change only when the numbers
support it.** This directory holds the tools and the recorded results.

| tool | what it measures |
| --- | --- |
| `LoadGenerator` | end to end over TCP: N connections, pipeline depth P, workloads `set get mixed persist sql sql-indexed`; ops/s and p50/p99/p99.9 latency. Uses only the wire protocol, so it measures **any** server version, including 0.0.x. |
| `Compare` | a Markdown table of two result files (speed-up, p99, errors) |
| JMH (`StorageBenchmark`, `SqlBenchmark`, `CodecBenchmark`) | the engine without the network: cache/durable writes, reads, INCR, SQL lookups/joins/aggregates, log record encoding |
| `run.sh` | builds this checkout, starts it in a temporary directory, runs the matrix, appends to `results/<label>.jsonl`, compares with the previous file |

```sh
bash benchmarks/run.sh my-change                         # this checkout
BENCH_SERVER_JAR=old.jar bash benchmarks/run.sh old       # another build, same tool
java -jar benchmarks/target/denis-benchmarks.jar          # JMH (after run.sh or mvn -f benchmarks/pom.xml package)
```

CI runs the matrix and JMH weekly and on demand (`.github/workflows/benchmark.yml`)
and publishes the tables in the job summary.

## 0.6.1 → 0.7.0

Intel Core i9-13900K (32 threads), 64 GB, NVMe SSD, Windows 11, Temurin 17.0.20,
loopback, 64-byte values, 10 s per run after 3 s warm-up, both with their
default configuration (0.6.1: journal fsynced every second; 0.7: `fsync=everysec`).
Files: [`results/0.6.1.jsonl`](results/0.6.1.jsonl) (release jar of master) and
[`results/0.7.0.jsonl`](results/0.7.0.jsonl) (the 0.7.0 release jar, measured on
2026-09-30 with `benchmarks/run.sh 0.7.0`; all runs 0 errors).

| workload (connections, pipeline) | 0.6.1 ops/s | 0.7.0 ops/s | speed-up | p99 0.6.1 | p99 0.7.0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| SET, cache (8, 16) | 107,810 | 1,510,687 | 14.0× | 2,302 µs | 127 µs |
| GET (8, 16) | 119,586 | 1,466,724 | 12.3× | 1,863 µs | 132 µs |
| 80 % GET / 20 % SET (8, 16) | 99,183 | 1,198,173 | 12.1× | 2,379 µs | 152 µs |
| 80 % GET / 20 % SET, no pipelining (32, 1) | 72,602 | 193,032 | 2.7× | 1,277 µs | 345 µs |
| durable SET `-&save` (8, 16) | 47,330 | 1,375,478 | 29.1× | 1,750 µs | 167 µs |
| durable SET `-&save` (1, 1) | 9,293 | 18,540 | 2.0× | 108 µs | 119 µs |
| SQL `SELECT … WHERE id = ?`, 1000 rows (8, 16) | 127,690 | 192,537 | 1.5× | 1,625 µs | 786 µs |
| same with an index / PRIMARY KEY (8, 16) | 130,096 | 205,385 | 1.6× | 1,641 µs | 784 µs |

0.6.1 already had an in-memory store, a journal and hash-indexed SQL tables;
the difference is the thread-per-connection server and synchronous per-command
work against 0.7's event loops, group commit and pipelined reply batching.

### 0.7 engine before the merge vs the 0.7.0 release

The first 0.7 measurement ([`results/0.7.0-engine.jsonl`](results/0.7.0-engine.jsonl), same
machine and settings) was taken on the new storage/network/SQL engine before master's
ADMIN, quota and `QUERY` features were merged into it. The release build is slower on
some workloads:

| workload (connections, pipeline) | engine ops/s | 0.7.0 ops/s | change |
| --- | ---: | ---: | ---: |
| SET, cache (8, 16) | 1,893,926 | 1,510,687 | −20 % |
| GET (8, 16) | 1,547,650 | 1,466,724 | −5 % |
| 80 % GET / 20 % SET (8, 16) | 1,568,176 | 1,198,173 | −24 % |
| 80 % GET / 20 % SET, no pipelining (32, 1) | 198,245 | 193,032 | −3 % |
| durable SET `-&save` (8, 16) | 1,314,868 | 1,375,478 | +5 % |
| durable SET `-&save` (1, 1) | 32,152 | 18,540 | −42 % |
| SQL `SELECT … WHERE id = ?` (8, 16) | 218,001 | 192,537 | −12 % |
| same with a PRIMARY KEY (8, 16) | 251,672 | 205,385 | −18 % |

Each number is one 10 s run, so differences of a few percent are noise. The larger drops
(cache SET, mixed, the single-connection durable SET, SQL) have not been investigated: the
merge adds a quota check (two volatile reads per write) and new command paths, but no
profile was taken to attribute them. The p99 latencies stay under 0.8 ms everywhere.
Repeat with `benchmarks/run.sh` before drawing conclusions about a single row.

## 0.0.2.9 → 0.7.0

Intel Core i9-13900K (32 threads), 64 GB, NVMe SSD, Windows 11, Temurin 17.0.20,
loopback, 64-byte values, 10 s per run after 3 s warm-up; 0.0.2.9 with its
default configuration, 0.7.0 with `fsync=everysec` (default). Files:
[`results/0.0.2.9.jsonl`](results/0.0.2.9.jsonl) (measured 2026-09-23),
[`results/0.7.0.jsonl`](results/0.7.0.jsonl) (2026-09-30).

| workload (connections, pipeline) | 0.0.2.9 ops/s | 0.7.0 ops/s | speed-up | p99 0.0.2.9 | p99 0.7.0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| SET, cache (8, 16) | 80,511 | 1,510,687 | 18.8× | 2,324 µs | 127 µs |
| GET, durable data on disk (8, 16) | 6,534 | 1,466,724 | 224× | 26,771 µs | 132 µs |
| 80 % GET / 20 % SET (8, 16) | 80,236 | 1,198,173 | 14.9× | 2,323 µs | 152 µs |
| 80 % GET / 20 % SET, no pipelining (32, 1) | 52,600 | 193,032 | 3.7× | 2,055 µs | 345 µs |
| durable SET `-&save` (8, 16) | **every request failed**, `database.bin` corrupted | 1,375,478, 0 errors | — | — | 167 µs |
| durable SET `-&save` (1, 1) | 437 | 18,540 | 42.4× | 6,461 µs | 119 µs |
| SQL `SELECT … WHERE id = ?`, 1000 rows (8, 16) | 3,333 | 192,537 | 57.8× | 45,293 µs | 786 µs |
| same with `id` as PRIMARY KEY (8, 16) | — | 205,385 | — | — | 784 µs |

Where the old numbers came from: every `GET` re-read and parsed the whole
`database.bin`, every durable `SET` rewrote it (concurrent writers truncated
each other's file), SQL parsed every row of every project from JSON on every
query, and every command was logged synchronously to console and file.

Other effects of the same release: the jar went from 15.2 MB to 1.6 MB; the
Docker container idles at ~35 MB RAM; after 14 million durable writes the data
directory held 16 MB (checkpoints remove old log segments).

### JMH (0.7 engine, [`results/jmh-0.7.0-engine.json`](results/jmh-0.7.0-engine.json), same machine, quick settings, indicative)

| benchmark | ops/s |
| --- | ---: |
| `StorageBenchmark.get` (100k keys) | ~21 M |
| `StorageBenchmark.getConcurrent` (4 threads) | ~73 M |
| `StorageBenchmark.putCache` | ~5.9 M |
| `StorageBenchmark.putDurable` (log, `everysec`) | ~2.0 M |
| `SqlBenchmark.pointLookupByPrimaryKey` (10k rows) | ~1.27 M |
| `SqlBenchmark.joinWithIndex` | ~0.82 M |
| `SqlBenchmark.latestTenByIndex` (`ORDER BY ts DESC LIMIT 10`) | ~0.59 M |
| `SqlBenchmark.pointLookupFullScan` (10k rows, no index) | ~11 k |
| `SqlBenchmark.groupByAggregate` (10k rows) | ~2.7 k |
| `CodecBenchmark.encodePut` | ~20 M |

### Experiments that were measured and not kept

- **Lock-free write-ahead-log queue** (MPSC queue instead of
  `LinkedBlockingQueue`): durable writes stayed at ~2.1 M/s with 1 and 4
  writer threads. The limit is the log's file-write bandwidth (~180 MB/s of
  records here), not the queue lock, so the simpler queue stayed.
- **More event loops**: 4 → 8 loops raised unpipelined throughput with 32
  connections from 119 k to 184 k ops/s; 16 loops gave 166 k. The default is
  one loop per two cores, at most 8.

## Reading the numbers

- Pipelined results measure the server; unpipelined ones mostly measure
  round trips (loopback latency and client threads).
- The load generator runs on the same machine and competes for CPU; on a
  separate client machine the server-side numbers are higher.
- Windows loopback and NIO are slower than Linux/epoll; expect better
  unpipelined numbers on Linux.
- Compare only results from the same machine; commit a results file together
  with the change it documents.
