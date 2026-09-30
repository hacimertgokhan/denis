// Everything the video claims lives here, so it can be checked against its source.

/**
 * Real output of `denis cli exec -g crm -p s3cret --create-project ...` against
 * target/denis-0.7.0.jar (captured 2026-09-30).
 */
export const terminalScript: {cmd: string; reply: string; table?: boolean}[] = [
  {cmd: 'SET greeting hello world -&save', reply: 'Ok (Protobuf)'},
  {cmd: 'GET greeting', reply: 'hello world'},
  {cmd: 'CREATE TABLE users (id INT PRIMARY KEY, name TEXT)', reply: 'OK: table created'},
  {cmd: "INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Grace')", reply: 'OK: 2 rows inserted'},
  {
    cmd: 'SELECT * FROM users ORDER BY id',
    reply: 'id | name\n---+------\n1  | Ada\n2  | Grace\n(2 row(s))',
    table: true,
  },
];

/**
 * benchmarks/results/0.6.1.jsonl -> benchmarks/results/0.7.0.jsonl
 * (Intel i9-13900K, Windows 11, loopback, 64-byte values, 8 connections, pipeline 16).
 */
export const bench = {
  previous: '0.6.1',
  version: '0.7.0',
  headline: {
    opsPerSec: 1510687,
    p99us: 127,
    caption: 'SET, 8 connections, pipelined',
  },
  rows: [
    {label: 'SET (cache)', before: 107810, now: 1510687, speedup: '14.0×'},
    {label: 'GET', before: 119586, now: 1466724, speedup: '12.3×'},
    {label: 'Durable SET (-&save)', before: 47330, now: 1375478, speedup: '29.1×'},
    {label: 'SQL lookup by primary key', before: 130096, now: 205385, speedup: '1.6×'},
  ],
};

export const features = [
  {icon: 'shield', title: 'Durable', text: 'Write-ahead log, group commit, crash recovery'},
  {icon: 'table', title: 'SQL', text: 'Joins, indexes, EXPLAIN, bound parameters'},
  {icon: 'bolt', title: '1.6 MB', text: 'One jar, no external services'},
  {icon: 'spark', title: 'AI-ready', text: 'MCP server for assistants'},
  {icon: 'window', title: 'Denis Studio', text: 'Desktop app for Windows, macOS, Linux'},
  {icon: 'box', title: 'Docker', text: 'amd64 and arm64 images'},
];
