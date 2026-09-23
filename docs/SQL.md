# Denis SQL

Denis SQL runs inside a project (after `AUTH <token>`). Send statements with
`SQL <statement>` (or type them directly), or — from applications — with
`QUERY {"sql": "...", "params": [...]}` so values are bound, never spliced
into the text.

Lexing follows MySQL/SQLite habits: keywords are case-insensitive, strings use
`'...'` (or `"..."`), identifiers can be quoted with backticks, `--` and
`/* */` are comments. Identifiers are case-insensitive.

## Types

| declared as | stored as |
| --- | --- |
| `INT`, `INTEGER`, `BIGINT`, `SMALLINT`, `SERIAL` | 64-bit integer |
| `REAL`, `FLOAT`, `DOUBLE`, `DECIMAL`, `NUMERIC` | 64-bit float |
| `TEXT`, `VARCHAR(n)`, `CHAR`, `JSON`, `UUID`, `DATE`, `TIMESTAMP` | text |
| `BOOL`, `BOOLEAN` | boolean |
| anything else | the value as given |

Values are converted on insert (`'42'` into an INT column is 42); a value that
cannot be converted is an error. Integer arithmetic stays integer (`7 / 2` is
3, as in SQLite and PostgreSQL); division by zero is NULL.

## Tables and indexes

```sql
CREATE TABLE [IF NOT EXISTS] readings (
  id      INTEGER PRIMARY KEY,          -- omitted on INSERT: next number
  sensor  TEXT NOT NULL,
  ts      INT NOT NULL,
  value   REAL DEFAULT 0,
  note    TEXT UNIQUE
);
CREATE [UNIQUE] INDEX [IF NOT EXISTS] idx_ts ON readings (ts);
DROP INDEX [IF EXISTS] idx_ts;
ALTER TABLE readings ADD [COLUMN] unit TEXT DEFAULT 'C';
TRUNCATE [TABLE] readings;
DROP TABLE [IF EXISTS] readings;
SHOW TABLES;              SHOW INDEXES FROM readings;          DESCRIBE readings;
```

A PRIMARY KEY or UNIQUE column gets a unique index automatically. Every table
also has the pseudo column `_rowid`.

## Changing data

```sql
INSERT INTO readings (sensor, ts, value) VALUES ('a', 1, 20.5), ('b', 1, 19.0);
INSERT INTO readings VALUES (10, 'c', 2, 18.5, NULL);           -- all columns in order
UPSERT INTO kv (k, v) VALUES ('x', 1);                            -- also: REPLACE INTO, INSERT OR REPLACE
UPDATE readings SET value = value + 1, note = 'fixed' WHERE sensor = 'a' [LIMIT n];
DELETE FROM readings WHERE ts < 100 [LIMIT n];
```

A statement either applies completely or not at all with respect to
constraint checks: a multi-row INSERT with one duplicate key inserts nothing.

## Queries

```sql
SELECT [DISTINCT] columns | * | t.* | expr [AS alias]
FROM table [alias]
  [[INNER] JOIN | LEFT [OUTER] JOIN | CROSS JOIN other [alias] [ON condition]]...
[WHERE condition]
[GROUP BY expr, ...] [HAVING condition]
[ORDER BY expr [ASC|DESC], ...]
[LIMIT n [OFFSET m]]            -- or LIMIT m, n
```

Conditions: `= != <> < <= > >=`, `AND OR NOT`, `IN (...)`, `BETWEEN a AND b`,
`LIKE` (`%`, `_`, case-insensitive), `IS [NOT] NULL`, `CASE WHEN ... THEN ...
ELSE ... END`, arithmetic `+ - * / %`, string concatenation `||`. Comparisons
with NULL are NULL (three-valued logic); WHERE keeps rows whose condition is
true. `ORDER BY` accepts output aliases and positions (`ORDER BY 2`); NULLs
sort first ascending.

Aggregates: `COUNT(*)`, `COUNT([DISTINCT] x)`, `SUM`, `TOTAL`, `AVG`, `MIN`,
`MAX`, `GROUP_CONCAT(x [, sep])`.

Scalar functions: `UPPER LOWER LENGTH TRIM LTRIM RTRIM SUBSTR(s, start[, len])
REPLACE(s, a, b) INSTR CONCAT STARTS_WITH ENDS_WITH ABS ROUND(x[, digits])
FLOOR CEIL SIGN SQRT POWER MOD COALESCE IFNULL NULLIF IIF(c, a, b) MIN_OF
MAX_OF INT REAL TEXT TYPEOF NOW() UNIX_MILLIS() UNIX_TIMESTAMP() RANDOM()
JSON_EXTRACT(json, '$.path[0].field')`.

`SELECT` without `FROM` evaluates expressions: `SELECT 1 + 1, NOW()`.

## Performance

`EXPLAIN SELECT ...` (also UPDATE/DELETE) shows how a statement runs:

```
SEARCH readings USING INDEX idx_ts (ts range, descending)
LIMIT 10 (stops early)
```

- Put a PRIMARY KEY or an index on columns you filter or join on; equality,
  `IN`, ranges and `BETWEEN` on the first table use it.
- `WHERE ts > ? ORDER BY ts DESC LIMIT 10` on an indexed column reads 10 rows,
  not the table (ideal for "latest readings" on devices).
- Use `QUERY` with `?` parameters: the statement text stays the same, so it is
  parsed once and cached.
- Results larger than `max-result-rows` (default 100 000) are refused; page
  with `LIMIT/OFFSET` or a range on an indexed column.

## Example: sensor data

```sql
CREATE TABLE readings (id INTEGER PRIMARY KEY, sensor TEXT NOT NULL, ts INT NOT NULL, value REAL);
CREATE INDEX idx_ts ON readings (ts);
CREATE TABLE sensors (name TEXT PRIMARY KEY, room TEXT);

-- latest ten readings
SELECT sensor, ts, value FROM readings WHERE ts > ? ORDER BY ts DESC LIMIT 10;
-- average per room in the last hour
SELECT s.room, COUNT(*) AS n, ROUND(AVG(r.value), 1) AS avg
FROM readings r JOIN sensors s ON s.name = r.sensor
WHERE r.ts > ? GROUP BY s.room HAVING n > 10 ORDER BY avg DESC;
-- JSON payloads
SELECT JSON_EXTRACT(payload, '$.battery') FROM events WHERE device = ?;
```
