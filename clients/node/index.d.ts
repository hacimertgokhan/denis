import { EventEmitter } from "node:events";

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
  /** Login group (LIN). Omit to skip login (only PING/HELLO/MODE work then). */
  group?: string;
  /** Password of the group; may contain spaces. */
  password?: string;
  /** Project token to AUTH with. */
  token?: string;
  /** When no token is given, create a project with AUTH CREATE on the first connection. Default false */
  createProject?: boolean;
  /** Pooled connections. Default 4 */
  poolSize?: number;
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

export type DenisErrorCode =
  // client side
  | "ECONN"
  | "ETIMEOUT"
  | "ECLOSED"
  | "EINVAL"
  | "EPROTO"
  | "ESERVER"
  // server side (the reply's `code`)
  | "NOAUTH"
  | "NOPROJECT"
  | "AUTH"
  | "LOCKED"
  | "FORBIDDEN"
  | "USAGE"
  | "NOTFOUND"
  | "SQL"
  | "OOM"
  | "PERSISTENCE"
  | "TYPE"
  | "RESERVED"
  | "BUSY"
  | "LIMIT"
  | "UNKNOWN"
  | "INTERNAL"
  | "IO"
  | (string & {});

/** A parsed server reply (MODE json). Unknown fields may appear in later server versions. */
export interface DenisReply {
  ok: boolean;
  message?: string;
  error?: string;
  code?: string;
  key?: string;
  data?: any;
  token?: string;
  /** The raw line, when the server answered in text mode. */
  raw?: string;
  [field: string]: any;
}

export class DenisError extends Error {
  constructor(message: string, code: DenisErrorCode, reply?: DenisReply);
  code: DenisErrorCode;
  /** The server reply, when there was one. */
  reply?: DenisReply;
  /** import(): what was imported before the failing IMPORT line. */
  imported?: ImportResult;
}

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

export type SqlValue = string | number | boolean | null | bigint | Date;

export interface QueryResult {
  /** Column names of a result set ([] for changes). */
  columns: string[];
  /** Rows of a result set ([] for changes). */
  rows: any[][];
  /** Number of rows returned. */
  count: number;
  /** Rows changed by INSERT/UPDATE/DELETE. */
  affected: number;
  lastRowId: number | null;
  message: string | null;
}

export interface DumpTable {
  columns: Array<{ name: string; type: string; primaryKey?: boolean; notNull?: boolean; [field: string]: any }>;
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
  /** Timeout per IMPORT line in ms. Default: commandTimeout */
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

export interface ProjectInfo {
  token: string;
  owner: string | null;
  keys: number;
  tables: number;
  current: boolean;
}

export interface SaveResult {
  message: string;
  bytes: number;
  records: number;
  millis: number;
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

export interface ServerInfo {
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

export interface ReconnectEvent {
  attempt: number;
  delay: number;
  error: DenisError;
}

type Value = string | number | boolean | object | null;

/** Commands shared by the client (one promise each) and pipelines (one result slot each). */
interface Commands<R extends { [K in keyof ResultMap]: unknown }> {
  ping(): R["ping"];
  hello(): R["hello"];
  get(key: string, opts?: GetOptions): R["get"];
  getJSON(key: string, opts?: GetOptions): R["getJSON"];
  set(key: string, value: Value, opts?: SetOptions): R["set"];
  update(key: string, value: Value): R["update"];
  del(key: string, opts?: DelOptions): R["del"];
  exists(key: string): R["exists"];
  keys(pattern?: string, opts?: KeysOptions): R["keys"];
  mget(keys: string[]): R["mget"];
  incr(key: string, delta?: number, opts?: CounterOptions): R["incr"];
  decr(key: string, delta?: number, opts?: CounterOptions): R["decr"];
  expire(key: string, seconds: number): R["expire"];
  ttl(key: string): R["ttl"];
  persist(key: string): R["persist"];
  dbsize(): R["dbsize"];
  clear(): R["clear"];
  sql(statement: string): R["sql"];
  query(sql: string, params?: SqlValue[]): R["query"];
  queryObjects(sql: string, params?: SqlValue[]): R["queryObjects"];
  dump(opts?: { timeout?: number }): R["dump"];
  info(): R["info"];
  whoami(): R["whoami"];
  projects(): R["projects"];
  createProject(): R["createProject"];
  deleteProject(token: string): R["deleteProject"];
  save(opts?: { timeout?: number }): R["save"];
  backup(opts?: { timeout?: number }): R["backup"];
  backups(): R["backups"];
  command(line: string, opts?: { timeout?: number }): R["command"];
}

interface ResultMap {
  ping: true;
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
  sql: string;
  query: QueryResult;
  queryObjects: Record<string, any>[];
  dump: Dump;
  info: ServerInfo;
  whoami: WhoAmI;
  projects: ProjectInfo[];
  createProject: string;
  deleteProject: true;
  save: SaveResult;
  backup: BackupResult;
  backups: BackupList;
  command: DenisReply;
}

type Promised = { [K in keyof ResultMap]: Promise<ResultMap[K]> };
type Chained = { [K in keyof ResultMap]: DenisPipeline };

export interface DenisClient extends Commands<Promised> {}

/** A pool of pipelined, authenticated connections. */
export class DenisClient extends EventEmitter {
  constructor(options?: DenisClientOptions);
  readonly options: Required<Omit<DenisClientOptions, "reconnect" | "group" | "password" | "token">> &
    Pick<DenisClientOptions, "group" | "password" | "token"> & { reconnect: Required<ReconnectOptions> | null };
  /** The current project token (given, created with createProject: true, or selected with use()). */
  readonly token: string | undefined;
  /** Open the pool eagerly (commands also connect on demand). */
  connect(): Promise<this>;
  /** getJSON with a result type. */
  getJSON<T = any>(key: string, opts?: GetOptions): Promise<T | null>;
  /** queryObjects with a row type. */
  queryObjects<T = Record<string, any>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Switch every pooled connection (and future ones) to another project. */
  use(token: string): Promise<true>;
  /** IMPORT a dump (object or JSON text); large dumps are sent as several IMPORT lines. */
  import(data: Partial<Dump> | string, opts?: ImportOptions): Promise<ImportResult>;
  /** Commands sent in one write on one connection. */
  pipeline(): DenisPipeline;
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

export interface DenisPipeline extends Commands<Chained> {}

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
