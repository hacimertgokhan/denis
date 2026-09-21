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
  /** Milliseconds. Default 5000 */
  connectTimeout?: number;
  /** Milliseconds per command. Default 10000 */
  commandTimeout?: number;
}

export type DenisErrorCode = "ECONN" | "ETIMEOUT" | "EAUTH" | "EPROTO" | "ESERVER" | "ECLOSED" | "EINVAL";

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
  project?: { cachedKeys: number; persistedKeys: number };
  memory: { usedMb: number; maxMb: number };
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

export class DenisClient {
  constructor(options?: DenisClientOptions);
  /** The project token in use (given, or created by the first connection). */
  token: string | undefined;
  connect(): Promise<this>;
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
  createProject(): Promise<string>;
  /** Send a raw protocol line on a pooled connection. */
  command(line: string): Promise<DenisReply>;
  close(): Promise<void>;
}
