export interface DenisClientOptions {
  /** Server host. Default 127.0.0.1 */
  host?: string;
  /** Server port. Default 5142 */
  port?: number;
  /** Login group (LIN). Omit to skip login (only PING/MODE/HELP work then). */
  group?: string;
  /** Password of the group. */
  password?: string;
  /** Project token (AUTH). */
  token?: string;
  /** When no token is given, create a project with AUTH CREATE. Default false */
  createProject?: boolean;
  /** Connections kept open at most. Default 4 */
  poolSize?: number;
  /** Send several commands per connection without waiting for each reply (replies arrive in order). Default true */
  pipeline?: boolean;
  /** Milliseconds. Default 5000 */
  connectTimeout?: number;
  /** Milliseconds per command. Default 10000 */
  commandTimeout?: number;
}

export type DenisErrorCode = "ECONN" | "ETIMEOUT" | "EAUTH" | "EPROTO" | "ESERVER" | "ECLOSED" | "EINVAL" | "ELIMIT";

export interface DenisReply {
  ok: boolean;
  message?: string;
  error?: string;
  key?: string;
  data?: string | null;
  token?: string;
  raw?: string;
  [field: string]: unknown;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rows: number;
}

export type SqlValue = string | number | boolean | null;
export type SqlRow = Record<string, SqlValue>;

export type SqlResult =
  | { type: "rows"; columns: string[]; rows: SqlRow[]; count: number }
  | { type: "affected"; affected: number; message: string }
  | { type: "tables"; tables: TableInfo[]; count: number };

export interface ServerInfo {
  version: string;
  uptimeSeconds: number;
  startedAt: string;
  connections: { open: number; total: number };
  commandsTotal: number;
  cacheKeys: number;
  persistedKeys: number;
  persistedDirty: boolean;
  projects: number;
  group: string;
  project?: ProjectUsage & { quota: ProjectQuota };
  memory: { usedMb: number; maxMb: number };
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

export interface ProjectInfo {
  token: string;
  usage: ProjectUsage;
  quota: ProjectQuota;
}

export interface DenisAdmin {
  list(): Promise<ProjectInfo[]>;
  create(quota?: Partial<ProjectQuota>): Promise<{ token: string; message: string }>;
  usage(token: string): Promise<ProjectInfo>;
  quota(token: string, maxKeys: number, maxBytes: number): Promise<ProjectInfo & { message: string }>;
  flush(token: string): Promise<true>;
  drop(token: string): Promise<true>;
}

export interface CommandDoc {
  name: string;
  usage: string;
  description: string;
  needsLogin: boolean;
  needsProject: boolean;
}

export class DenisError extends Error {
  code: DenisErrorCode;
  reply?: DenisReply;
}

export class DenisConnection {
  constructor(options: Required<Pick<DenisClientOptions, "host" | "port" | "connectTimeout" | "commandTimeout">> & DenisClientOptions);
  token: string | undefined;
  connect(): Promise<void>;
  handshake(): Promise<void>;
  raw(line: string): Promise<DenisReply>;
  destroy(): void;
}

/** The key-value / SQL API shared by DenisClient (TCP) and DenisCloud (HTTPS). */
export class DenisCommands {
  /** Send a raw protocol line and resolve with the parsed reply. */
  command(line: string): Promise<DenisReply>;
  ping(): Promise<boolean>;
  get(key: string, opts?: { source?: "cache" | "protobuf" }): Promise<string | null>;
  getJSON<T = unknown>(key: string, opts?: { source?: "cache" | "protobuf" }): Promise<T | null>;
  set(key: string, value: string | object | number | boolean, opts?: { persist?: boolean }): Promise<true>;
  update(key: string, value: string | object | number | boolean): Promise<true>;
  del(key: string, opts?: { cache?: boolean; protobuf?: boolean }): Promise<true>;
  exists(key: string): Promise<boolean>;
  keys(pattern?: string): Promise<string[]>;
  mget(keys: string[]): Promise<Record<string, string | null>>;
  clear(): Promise<true>;
  save(): Promise<true>;
  info(): Promise<ServerInfo>;
  help(): Promise<CommandDoc[]>;
  sql(query: string): Promise<SqlResult>;
  query(sql: string): Promise<SqlRow[]>;
  execute(sql: string): Promise<number>;
  tables(): Promise<TableInfo[]>;
  describe(table: string): Promise<TableInfo | null>;
}

export class DenisClient extends DenisCommands {
  constructor(options?: DenisClientOptions);
  /** The project token in use (given, or created by the first connection). */
  token: string | undefined;
  connect(): Promise<this>;
  createProject(): Promise<string>;
  /** ADMIN commands with the server's main token. */
  admin(mainToken: string): DenisAdmin;
  close(): Promise<void>;
}

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
