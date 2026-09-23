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

## 0.0.2.9 → 0.1.0

Intel Core i9-13900K (32 threads), 64 GB, NVMe SSD, Windows 11, Temurin 17.0.20,
loopback, 64-byte values, 10 s per run after 3 s warm-up; 0.0.2.9 with its
default configuration, 0.1.0 with `fsync=everysec` (default). Files:
[`results/0.0.2.9.jsonl`](results/0.0.2.9.jsonl), [`results/0.1.0.jsonl`](results/0.1.0.jsonl).

| workload (connections, pipeline) | 0.0.2.9 ops/s | 0.1.0 ops/s | speed-up | p99 0.0.2.9 | p99 0.1.0 |
| --- | ---: | ---: | ---: | ---: | ---: |
| SET, cache (8, 16) | 80,511 | 1,893,926 | 23.5× | 2,324 µs | 136 µs |
| GET, durable data on disk (8, 16) | 6,534 | 1,547,650 | 237× | 26,771 µs | 158 µs |
| 80 % GET / 20 % SET (8, 16) | 80,236 | 1,568,176 | 19.5× | 2,323 µs | 152 µs |
| 80 % GET / 20 % SET, no pipelining (32, 1) | 52,600 | 198,245 | 3.8× | 2,055 µs | 359 µs |
| durable SET `-&save` (8, 16) | **every request failed**, `database.bin` corrupted | 1,314,868, 0 errors | — | — | 204 µs |
| durable SET `-&save` (1, 1) | 437 | 32,152 | 73.6× | 6,461 µs | 69 µs |
| SQL `SELECT … WHERE id = ?`, 1000 rows (8, 16) | 3,333 | 218,001 | 65× | 45,293 µs | 752 µs |
| same with `id` as PRIMARY KEY (8, 16) | — | 251,672 | — | — | 709 µs |

Where the old numbers came from: every `GET` re-read and parsed the whole
`database.bin`, every durable `SET` rewrote it (concurrent writers truncated
each other's file), SQL parsed every row of every project from JSON on every
query, and every command was logged synchronously to console and file.

Other effects of the same release: the jar went from 15.2 MB to 1.6 MB; the
Docker container idles at ~35 MB RAM; after 14 million durable writes the data
directory held 16 MB (checkpoints remove old log segments).

### JMH (0.1.0, same machine, quick settings, indicative)

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
