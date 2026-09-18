export interface DenisClientOptions {
  /** Server host. Default 127.0.0.1 */
  host?: string;
  /** Server port. Default 5142 */
  port?: number;
  /** Login group (LIN). Omit to skip login (only PING/MODE work then). */
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
  clear(): Promise<true>;
  sql(query: string): Promise<string>;
  createProject(): Promise<string>;
  /** Send a raw protocol line on a pooled connection. */
  command(line: string): Promise<DenisReply>;
  close(): Promise<void>;
}
