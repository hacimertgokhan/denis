import { EventEmitter } from "node:events";

// ======================================================================= options

export interface ReconnectOptions {
  /** Attempts per dropped connection before giving up (then "error" is emitted). Default 5 */
  retries?: number;
  /** First backoff delay in ms (doubles each attempt, with jitter). Default 100 */
  minDelay?: number;
  /** Upper bound of the backoff delay in ms. Default 5000 */
  maxDelay?: number;
}

export interface DenisClientOptions {
  /** Server host. Default 127.0.0.1 */
  host?: string;
  /** Server port. Default 5142 */
  port?: number;
  /** Login group (LIN). Omit to skip login (only PING/HELLO/HELP/MODE/ADMIN work then). */
  group?: string;
  /** Password of the group; may contain spaces. */
  password?: string;
  /** Project token (AUTH). */
  token?: string;
  /** When no token is given, create a project with AUTH CREATE on the first connection. Default false */
  createProject?: boolean;
  /** Connections kept open at most; opened on demand. Default 4 */
  poolSize?: number;
  /** false: one command in flight per connection (same as maxPending: 1). Default true */
  pipeline?: boolean;
  /** Milliseconds. Default 5000 */
  connectTimeout?: number;
  /** Milliseconds per command (0 disables). A timed-out connection is dropped and re-opened. Default 10000 */
  commandTimeout?: number;
  /** Reconnect policy for dropped connections, or false to only reconnect on demand. */
  reconnect?: ReconnectOptions | boolean;
  /** Commands in flight per connection before new ones wait in the client queue. Default 10000 */
  maxPending?: number;
  /** import() splits dumps larger than this into several IMPORT lines. Default 1 MiB */
  importChunkBytes?: number;
}

// ======================================================================= errors and replies

/**
 * Client-side codes. A server error (`ok:false`) is ESERVER — EAUTH when LIN or AUTH was refused —
 * with the server's own code (SQL, NOTFOUND, QUOTA, AUTH, ...) in `serverCode` and `reply.code`.
 */
export type DenisErrorCode = "ECONN" | "ETIMEOUT" | "EAUTH" | "EPROTO" | "ESERVER" | "ECLOSED" | "EINVAL" | "ELIMIT";

/** The server's `code` field of an ok:false reply (docs/PROTOCOL.md); Denis Cloud adds its gateway codes. */
export type DenisServerCode =
  | "NOAUTH"
  | "NOPROJECT"
  | "AUTH"
  | "LOCKED"
  | "FORBIDDEN"
  | "USAGE"
  | "NOTFOUND"
  | "SQL"
  | "QUOTA"
  | "OOM"
  | "PERSISTENCE"
  | "TYPE"
  | "RESERVED"
  | "BUSY"
  | "LIMIT"
  | "UNKNOWN"
  | "INTERNAL"
  | "IO"
  | "READ_ONLY"
  | (string & {});

/** A parsed server reply (MODE json). Unknown fields may appear in later server versions. */
export interface DenisReply {
  ok: boolean;
  message?: string;
  error?: string;
  code?: string;
  key?: string;
  /** The value of GET; other commands use it for their legacy text or data. */
  data?: any;
  token?: string;
  /** The raw line, when the server answered in text mode. */
  raw?: string;
  [field: string]: unknown;
}

export class DenisError extends Error {
  constructor(message: string, code: DenisErrorCode, reply?: DenisReply | Record<string, unknown>);
  code: DenisErrorCode;
  /** The server's code (reply.code), when the server sent one. */
  serverCode?: DenisServerCode;
  /** The server reply (Denis Cloud: the HTTP status and body), when there was one. */
  reply?: DenisReply;
  /** import(): what was imported before the failing IMPORT line. */
  imported?: ImportResult;
}

// ======================================================================= results

export interface HelloReply {
  server: string;
  version: string;
  protocol: number;
  features: string[];
  loggedIn: boolean;
}

export interface GetOptions {
  /** "protobuf" prefers the durable value (-&from-protobuff). Reads prefer the cache value otherwise. */
  source?: "cache" | "protobuf";
}

export interface SetOptions {
  /** Also write the durable value (-&save). */
  persist?: boolean;
  /** Expire the cache value after this many seconds (-&ttl=). */
  ttl?: number;
}

export interface DelOptions {
  /** Only the cache value. */
  cache?: boolean;
  /** Only the durable value. */
  protobuf?: boolean;
}

export interface KeysOptions {
  /** Default "any" */
  layer?: "any" | "cache" | "persistent";
  /** At most this many keys (the server also caps it). */
  limit?: number;
}

export interface CounterOptions {
  /** Also write the durable value (-&save). */
  persist?: boolean;
}

export interface DbSize {
  keys: number;
  cache: number;
  persistent: number;
  tables: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  primaryKey?: boolean;
  notNull?: boolean;
  [field: string]: unknown;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rows: number;
}

export type SqlValue = string | number | boolean | null;
/** Bound parameters: bigint is sent as a number (or a string beyond 2^53), Date as its ISO string. */
export type SqlParam = SqlValue | bigint | Date;
export type SqlRow = Record<string, SqlValue>;

export type SqlResult =
  | { type: "rows"; columns: string[]; rows: SqlRow[]; count: number }
  | { type: "affected"; affected: number; message: string; lastRowId?: number | null }
  | { type: "tables"; tables: TableInfo[]; count: number };

export interface GraphResult<T = Record<string, unknown>> {
  data: T;
  errors: { path: string; error: string }[];
}

export interface ProjectQuota {
  /** 0 = unlimited */
  maxKeys: number;
  maxBytes: number;
}

export interface ProjectUsage {
  cachedKeys: number;
  cachedBytes: number;
  persistedKeys: number;
  persistedBytes: number;
}

/** A project as ADMIN reports it. */
export interface ProjectInfo {
  token: string;
  usage: ProjectUsage;
  quota: ProjectQuota;
}

/** INFO: the statistics object. */
export interface ServerInfo {
  version: string;
  uptimeSeconds: number;
  startedAt: string;
  connections: { open: number; total: number };
  commandsTotal: number;
  cacheKeys: number;
  persistedKeys: number;
  persistedDirty?: boolean;
  projects: number;
  group: string;
  project?: ProjectUsage & { quota: ProjectQuota };
  memory: { usedMb: number; maxMb: number };
  /** The detailed sections of the 0.1 server (server, clients, stats, memory, persistence, keyspace, project, recovery). */
  info?: ServerInfoSections;
  [field: string]: unknown;
}

export interface ServerInfoSections {
  server: Record<string, any>;
  clients: Record<string, any>;
  stats: Record<string, any>;
  memory: Record<string, any>;
  persistence: Record<string, any>;
  keyspace: Record<string, any>;
  project?: Record<string, any>;
  recovery?: Record<string, any>;
  [section: string]: any;
}

export interface CommandDoc {
  name: string;
  usage: string;
  description: string;
  needsLogin: boolean;
  needsProject: boolean;
}

export interface DumpTable {
  columns: ColumnInfo[];
  indexes: Array<{ name: string; column: string; unique: boolean }>;
  rows: any[][];
}

export interface Dump {
  format: number;
  server: string;
  version: string;
  createdAt: string;
  cache: Record<string, string>;
  persistent: Record<string, string>;
  /** Remaining TTL in ms per cache key. */
  ttl: Record<string, number>;
  tables: Record<string, DumpTable>;
  [field: string]: any;
}

export interface ImportOptions {
  /** Replace existing tables of the same name. Default false */
  replace?: boolean;
  /** Timeout per IMPORT line in ms (TCP). Default: commandTimeout */
  timeout?: number;
  /** Override the client's importChunkBytes. */
  chunkBytes?: number;
}

export interface ImportResult {
  persistent: number;
  cache: number;
  tables: number;
  rows: number;
}

export interface WhoAmI {
  group: string;
  admin: boolean;
  project: string | null;
}

/** A project as PROJECTS lists it for the logged-in group. */
export interface ProjectListEntry {
  token: string;
  owner: string | null;
  keys: number;
  tables: number;
  current: boolean;
}

export interface BackupInfo {
  name: string;
  path: string;
  bytes: number;
  createdAt: string;
}

export interface BackupResult extends BackupInfo {
  message: string;
}

export interface BackupList {
  backups: BackupInfo[];
  directory: string;
}

export interface DenisAdmin {
  list(): Promise<ProjectInfo[]>;
  create(quota?: Partial<ProjectQuota>): Promise<{ token: string; message: string }>;
  /** Register a token issued elsewhere (restore after the engine lost its registry). Idempotent. */
  import(token: string, quota?: Partial<ProjectQuota>): Promise<{ token: string; added: boolean; message: string }>;
  usage(token: string): Promise<ProjectInfo>;
  quota(token: string, maxKeys: number, maxBytes: number): Promise<ProjectInfo & { message: string }>;
  flush(token: string): Promise<true>;
  drop(token: string): Promise<true>;
}

export interface ReconnectEvent {
  attempt: number;
  delay: number;
  error: DenisError;
}

type Value = string | number | boolean | object | null;

// ======================================================================= commands

/** The commands every transport has, with the result type of each. */
interface CommandResults {
  ping: boolean;
  hello: HelloReply;
  get: string | null;
  getJSON: any;
  set: true;
  update: true;
  del: boolean;
  exists: boolean;
  keys: string[];
  mget: Record<string, string | null>;
  incr: number;
  decr: number;
  expire: boolean;
  ttl: number;
  persist: boolean;
  dbsize: DbSize;
  clear: true;
  save: true;
  info: ServerInfo;
  help: CommandDoc[];
  graph: GraphResult;
  queryGraph: GraphResult;
  sql: SqlResult;
  query: SqlRow[];
  queryObjects: SqlRow[];
  execute: number;
  tables: TableInfo[];
  describe: TableInfo | null;
  dump: Dump;
}

/** TCP-session commands (DenisClient and its pipelines). */
interface SessionResults {
  whoami: WhoAmI;
  projects: ProjectListEntry[];
  createProject: string;
  deleteProject: true;
  backup: BackupResult;
  backups: BackupList;
  command: DenisReply;
}

interface CommandMethods<R extends { [K in keyof CommandResults]: unknown }> {
  /** PING: true when the server answered ok. */
  ping(): R["ping"];
  /** HELLO: server name, version, protocol and features. */
  hello(): R["hello"];
  /** GET: the value, or null when the key does not exist. */
  get(key: string, opts?: GetOptions): R["get"];
  getJSON(key: string, opts?: GetOptions): R["getJSON"];
  /** SET: non-strings are JSON.stringify-ed. */
  set(key: string, value: Value, opts?: SetOptions): R["set"];
  /** UPDATE: cache-only overwrite. */
  update(key: string, value: Value): R["update"];
  /** DEL: whether the key existed (true when the server does not say). */
  del(key: string, opts?: DelOptions): R["del"];
  exists(key: string): R["exists"];
  keys(pattern?: string, opts?: KeysOptions): R["keys"];
  /** MGET: missing keys map to null; an empty array resolves to {}. */
  mget(keys: string[]): R["mget"];
  incr(key: string, delta?: number, opts?: CounterOptions): R["incr"];
  decr(key: string, delta?: number, opts?: CounterOptions): R["decr"];
  expire(key: string, seconds: number): R["expire"];
  ttl(key: string): R["ttl"];
  persist(key: string): R["persist"];
  dbsize(): R["dbsize"];
  /** HEAVEN: drop every cache value of the project. */
  clear(): R["clear"];
  /** SAVE: flush the persisted store now. */
  save(opts?: { timeout?: number }): R["save"];
  info(): R["info"];
  help(): R["help"];
  /** QUERY { ... }: a GraphQL-shaped document of reads resolved in one round trip. */
  graph(document: string): R["graph"];
  /** Alias of graph(). */
  queryGraph(document: string): R["queryGraph"];
  /** `SQL <statement>`, or `QUERY {"sql","params"}` when params are given (bound, may span lines). */
  sql(statement: string, params?: SqlParam[]): R["sql"];
  /** sql() for SELECT: the row objects. */
  query(sql: string, params?: SqlParam[]): R["query"];
  /** Alias of query(). */
  queryObjects(sql: string, params?: SqlParam[]): R["queryObjects"];
  /** sql() for INSERT/UPDATE/DELETE/DDL: the affected row count. */
  execute(sql: string, params?: SqlParam[]): R["execute"];
  /** SHOW TABLES */
  tables(): R["tables"];
  /** DESCRIBE <table>, or null when the table does not exist. */
  describe(table: string): R["describe"];
  /** DUMP: the whole project, the input of import(). */
  dump(opts?: { timeout?: number }): R["dump"];
}

interface SessionMethods<R extends { [K in keyof SessionResults]: unknown }> {
  /** WHOAMI: the group, whether it is an admin group, and the current project. */
  whoami(): R["whoami"];
  /** PROJECTS: the projects the logged-in group can open. */
  projects(): R["projects"];
  /** AUTH CREATE: a new project token (the client stays on its current project). */
  createProject(): R["createProject"];
  /** AUTH DELETE: deleting the current project leaves the client without one. */
  deleteProject(token: string): R["deleteProject"];
  /** BACKUP (admin group). */
  backup(opts?: { timeout?: number }): R["backup"];
  /** BACKUPS (admin group). */
  backups(): R["backups"];
  /** Any protocol line: the parsed reply, never rejects on ok:false. */
  command(line: string, opts?: { timeout?: number }): R["command"];
}

type Promised<M> = { [K in keyof M]: Promise<M[K]> };
type Chained<M> = { [K in keyof M]: DenisPipeline };

export interface DenisCommands extends CommandMethods<Promised<CommandResults>> {}

/** The key-value / SQL API shared by DenisClient (TCP) and DenisCloud (HTTPS). Subclasses implement command(). */
export class DenisCommands extends EventEmitter {
  /** Send a raw protocol line and resolve with the parsed reply. */
  command(line: string): Promise<DenisReply>;
  getJSON<T = any>(key: string, opts?: GetOptions): Promise<T | null>;
  graph<T = Record<string, unknown>>(document: string): Promise<GraphResult<T>>;
  queryGraph<T = Record<string, unknown>>(document: string): Promise<GraphResult<T>>;
  query<T = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]>;
  queryObjects<T = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** IMPORT a dump (object or JSON text); large dumps are sent as several IMPORT lines. */
  import(data: Partial<Dump> | string, opts?: ImportOptions): Promise<ImportResult>;
}

export interface DenisClient extends SessionMethods<Promised<SessionResults>> {}

/** A pool of pipelined, authenticated TCP connections, opened on demand. */
export class DenisClient extends DenisCommands {
  constructor(options?: DenisClientOptions);
  readonly options: Required<Omit<DenisClientOptions, "reconnect" | "group" | "password" | "token">> &
    Pick<DenisClientOptions, "group" | "password" | "token"> & { reconnect: Required<ReconnectOptions> | null };
  /** The current project token (given, created with createProject: true, or selected with use()). */
  readonly token: string | undefined;
  /** Open the whole pool now (commands also connect on demand). */
  connect(): Promise<this>;
  /** Any protocol line: the parsed reply, never rejects on ok:false. */
  command(line: string, opts?: { timeout?: number }): Promise<DenisReply>;
  /** Switch every pooled connection (and future ones) to another project. */
  use(token: string): Promise<true>;
  /** Commands sent in one write on one connection. */
  pipeline(): DenisPipeline;
  /** Raw protocol lines in one write on one connection; the replies in order. */
  batch(lines: string[], opts?: { timeout?: number }): Promise<DenisReply[]>;
  /** ADMIN commands with the server's main token. */
  admin(mainToken: string): DenisAdmin;
  /** EXIT every connection after its commands in flight. */
  close(): Promise<void>;

  on(event: "connect", listener: (info: { slot: number }) => void): this;
  on(event: "reconnect", listener: (info: ReconnectEvent) => void): this;
  on(event: "error", listener: (err: DenisError) => void): this;
  on(event: "close", listener: () => void): this;
  once(event: "connect", listener: (info: { slot: number }) => void): this;
  once(event: "reconnect", listener: (info: ReconnectEvent) => void): this;
  once(event: "error", listener: (err: DenisError) => void): this;
  once(event: "close", listener: () => void): this;
}

export interface DenisPipeline extends CommandMethods<Chained<CommandResults>>, SessionMethods<Chained<SessionResults>> {}

/** Queued commands; exec() resolves to one value or DenisError per command, in order. */
export class DenisPipeline {
  constructor(client: DenisClient);
  /** Number of queued commands. */
  readonly length: number;
  exec(opts?: { timeout?: number }): Promise<Array<any | DenisError>>;
}

/** One TCP session (used by the pool; usable on its own). */
export class DenisConnection extends EventEmitter {
  constructor(options?: DenisClientOptions);
  token: string | undefined;
  readonly closed: boolean;
  readonly ready: boolean;
  /** Commands waiting for their reply. */
  readonly inFlight: number;
  connect(): Promise<void>;
  /** MODE json, LIN, AUTH (AUTH CREATE with createProject). */
  handshake(): Promise<void>;
  /** Send one line; resolves with the parsed reply (never rejects on ok:false). */
  raw(line: string, opts?: { timeout?: number }): Promise<DenisReply>;
  /** EXIT after the commands in flight, then close. */
  quit(): Promise<void>;
  destroy(err?: Error): void;
  on(event: "close", listener: (err: DenisError | null) => void): this;
}

// ======================================================================= Denis Cloud

export interface DenisCloudOptions {
  /** API key from the database's Connect tab (dk_...). */
  apiKey?: string;
  /** An access token from POST /api/v1/token, instead of the key. */
  accessToken?: string;
  /** Platform URL. Default https://denis.hacimertgokhan.com */
  url?: string;
  /** Exchange the key for short-lived JWTs and refresh them automatically. Default false */
  useJwt?: boolean;
  /** Milliseconds per request. Default 15000 */
  timeout?: number;
  /** Custom fetch (tests, older runtimes). Default globalThis.fetch */
  fetch?: typeof fetch;
  /** import() splits dumps larger than this (the gateway takes commands up to 64 KB). Default 48 KiB */
  importChunkBytes?: number;
}

export interface CloudUsage {
  database: { id: string; name: string };
  scope: "read" | "write";
  usage: { cachedKeys: number; cachedBytes: number; persistedKeys: number; persistedBytes: number; opsToday: number; sampledAt: string | null };
  limits: { maxBytes: number; maxKeys: number; opsPerDay: number };
}

/** The same API over Denis Cloud's REST gateway with an API key; one HTTPS request per command. */
export class DenisCloud extends DenisCommands {
  constructor(options: DenisCloudOptions);
  url: string;
  /** Up to 50 commands in one request, answered in order. */
  batch(lines: string[]): Promise<DenisReply[]>;
  /** The database and scope behind the credential. */
  whoami(): Promise<{ database: { id: string; name: string }; scope: "read" | "write"; via: "api-key" | "jwt" }>;
  /** Usage against the database's limits. */
  usage(): Promise<CloudUsage>;
  close(): Promise<void>;
}
