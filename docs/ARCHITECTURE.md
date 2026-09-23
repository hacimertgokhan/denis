# Architecture

Denis is an in-memory database: every key and every table row lives in the
JVM heap, and the disk holds a write-ahead log plus snapshots so that memory
can be rebuilt after a restart. Reads never touch the disk.

```
 clients ──TCP──► acceptor ──► event loops (NIO, 1..8) ──► Session (protocol)
                                    │  fast commands inline      │ slow commands (login, SQL,
                                    │                            ▼ KEYS/DUMP/IMPORT, backups)
                                    │                      worker pool (bounded)
                                    ▼                            │
                             StorageEngine ◄─────────────────────┘
                   keyspaces (one per project) ─ slots + SQL tables
                                    │ durable changes
                                    ▼
                      write-ahead log writer (1 thread, group commit)
                                    │
                data/wal/wal-<n>.log ... + data/snapshot.dat (checkpoints)
```

## Memory layout

- **Keyspace** per project token: a `ConcurrentHashMap<String, Slot>`, a map of
  SQL tables, and counters. Projects never share maps, so they never contend.
- **Slot** (32 bytes): the cache value, the durable value, the cache TTL
  (`expireAt`) and an LRU clock. Both layers of a key share one map entry, and
  when they hold the same value they share one `String`. Writes replace the
  slot inside `ConcurrentHashMap.compute`, which serialises writers of the same
  key without any other lock.
- **Table**: rows are `Object[]` in column order in a `TreeMap<rowId, row>`
  (row-id order = insertion order), plus secondary indexes
  (`TreeMap<value, rowId | long[]>` — a boxed id for the unique case, an array
  only for repeated values). One read-write lock per table.
- Values are Java strings (compact strings: 1 byte per character for Latin-1
  text). The engine tracks an estimate of the bytes it holds; `max-memory`
  bounds it.

### Memory limit and eviction

With `max-memory` set, a write that would exceed it first evicts cache-only
keys (never durable data) chosen by **sampled LRU**: a cursor walks each
keyspace, looks at a handful of evictable slots and evicts the one with the
oldest access clock — no global LRU list that every read would have to lock.
With `eviction-policy=noeviction`, or when nothing is evictable, the write is
refused with code `OOM` instead of the JVM running out of heap.

### TTL

Only cache values expire. Expiry is lazy (checked on read) plus an active
sweep that looks at up to 256 keys with a TTL per keyspace every 100 ms, so
expired data does not linger in memory. A key with a durable value keeps it
after its cache value expires.

## Disk layout

```
data/
  snapshot.dat              latest snapshot (deflated), replaced atomically
  wal/wal-00000000000000000042.log   log segments since that snapshot
  backups/denis-<utc time>.zip       backups (retention applies)
denis.properties  denis.toml  ddb.json   configuration, groups, project tokens
logs/denis.log                            rotated at 10 MB × 5
```

### Records

The log and the snapshot share one format: a sequence of framed records

```
record := length:varint  crc32c:int32  body
body   := op:byte fields...      (Put, Delete, DefineKeyspace, CreateTable, PutRow, ...)
```

Every record states a new value (no deltas), so replaying a record twice
gives the same result — which is what makes non-blocking checkpoints safe.
Keyspaces are referred to by a small integer id (`DefineKeyspace` binds it to
the 128-character token), so a record for a short key is a few dozen bytes.
Row values are type-tagged (zig-zag varint integers, IEEE doubles, strings,
booleans, null).

### Write path and group commit

A durable write encodes its record on the caller's thread, then — inside the
`compute` of its key — hands the bytes to a bounded queue and installs the new
slot. One writer thread drains everything queued, writes it with one system
call per 256 KB buffer and, depending on `fsync`:

| `fsync` | acknowledgement | a power cut loses |
| --- | --- | --- |
| `always` | after the batch's `fsync` (many clients share one fsync) | nothing acknowledged |
| `everysec` (default) | after the OS has the bytes; fsync once per second | up to ~1 s |
| `no` | after the OS has the bytes | what the OS had not flushed |

The bounded queue is the back-pressure: if the disk cannot keep up, writers
wait instead of the heap filling up. In benchmarks the log accepts about
2 million records per second on a desktop SSD — the file write bandwidth, not
locking, is the limit (replacing the queue with a lock-free one did not change
the number, so the simpler queue stayed).

If the log cannot be written (disk full, device gone), durable writes are
refused with code `PERSISTENCE` rather than acknowledged and lost; the server
retries every second and, once the disk is back, takes a checkpoint that
covers everything accepted meanwhile.

### Checkpoints (non-blocking)

A checkpoint runs when the log exceeds `checkpoint-wal-size` or every
`checkpoint-interval-seconds` with changes, on `SAVE`, before a backup and at
shutdown:

1. Rotate the log: the writer closes segment *N-1* and starts *N*.
2. Wait for writes that queued their record before the rotation but have not
   yet published their new value. An *epoch* counter (two `LongAdder`s, no
   lock on the write path) tells exactly when they are done.
3. Stream every keyspace into `snapshot.dat.tmp` while writes continue,
   `fsync`, atomically rename over `snapshot.dat`.
4. Delete segments older than *N*.

Writes that happen during step 3 may or may not be in the snapshot; they are
certainly in segment *N* or later, and replaying them is idempotent. Disk use
is therefore bounded by the data size plus `checkpoint-wal-size`, whatever the
write volume (a 14-million-write benchmark left 16 MB on disk).

### Recovery

1. Load `snapshot.dat` (every record CRC-checked, the end record must match
   the count).
2. Replay segments from the snapshot's start segment.
3. The newest segment may end in a half-written record (power loss): it is
   cut back to the last intact record and the server starts. Damage anywhere
   else stops the start (`recovery=lenient` accepts losing it) — silently
   starting without data would be worse.
4. A Denis 0.0.x `database.bin` (protobuf) is imported once and renamed.

There are no lock files: the data directory belongs to the process that bound
the port; offline tools (`denis db compact`, `denis backup restore`) refuse to
run while a server answers on the configured port.

## Network

- One acceptor thread; `io-threads` event loops (default: one per two cores,
  1–8, measured optimum); connections are assigned round-robin.
- An event loop reads what a client sent, executes every complete line and
  writes all replies with one `write` — pipelined clients pay one system call
  per batch.
- Commands that can take long (PBKDF2 login, SQL, KEYS on big keyspaces,
  DUMP/IMPORT, SAVE/BACKUP) run on a bounded worker pool; the connection stops
  reading until the reply is ready, which keeps replies in order. A full
  worker queue answers `BUSY` instead of queueing without bound.
- A client that does not read its replies is not read from once
  `client-output-limit` bytes are pending; a line longer than `max-line-size`
  closes the connection; `max-clients` and `max-connections-per-ip` bound
  connections.

## SQL

`SqlParser` turns text into an immutable AST using an ANTLR 4 grammar
(`src/main/antlr4/.../DenisSql.g4`) with the fast SLL mode first and full LL
only on failure; parsed statements are cached (LRU, 512), so a query shape
with `?` parameters is parsed once. `SqlEngine` binds names to positions,
compiles expressions into closures and plans the first table's access:

| predicate on table 0 | access path |
| --- | --- |
| `_rowid = ?` | row-id lookup |
| `col = ?` with an index | index equality (unique preferred) |
| `col IN (...)` with an index | index lookups |
| `col > ? [AND col < ?]`, `BETWEEN` with an index | index range (also delivers ORDER BY col) |
| none, `ORDER BY col LIMIT n` on an indexed NOT NULL column | index-ordered scan, stops after n |
| otherwise | scan in row-id order |

Joined tables are probed through an index on the join column or through a
hash table built once per statement. `ORDER BY ... LIMIT n` without a usable
index keeps a bounded top-n heap instead of sorting everything; results larger
than `max-result-rows` are refused. `EXPLAIN` shows the plan.

Each statement holds its tables' locks for its whole run (read locks for
queries, the write lock for changes), so statements are atomic per table.
Multi-row INSERT/UPDATE validate every row (types, NOT NULL, UNIQUE) before
changing anything.

## Security

- Group passwords: PBKDF2-HMAC-SHA512 (210 000 iterations by default), random
  32-byte salt, constant-time comparison; 0.0.x SHA-512 hashes are upgraded on
  the next successful login. A successful login is remembered as an HMAC under
  a per-process key, so pooled clients pay for PBKDF2 once.
- Failed logins lock an address out (`login-max-failures`,
  `login-lockout-seconds`); unknown group names cost the same time as wrong
  passwords.
- Projects created by a group are only accessible to it and to admin groups.
- `bind-address` defaults to `127.0.0.1`.
- Logs never contain passwords or values (`LIN`, `AUTH`, `SET` values,
  `IMPORT` and `QUERY` are masked when command logging is on).
- TLS is not built in: expose Denis beyond a trusted network through an SSH
  tunnel, a VPN (WireGuard) or a TLS terminator such as stunnel/HAProxy.
