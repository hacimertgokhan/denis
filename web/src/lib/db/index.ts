import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __denisSql?: ReturnType<typeof postgres> };

// One connection pool per process (Next.js re-evaluates modules in dev).
const sql = globalForDb.__denisSql ?? postgres(env().DATABASE_URL, { max: 10, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.__denisSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
