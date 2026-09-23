import { relations, sql } from "drizzle-orm";
import { bigint, boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- better-auth
// Column names follow better-auth's defaults so the Drizzle adapter needs no mapping.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  /** Platform role: "user" or "admin" (system administrator). */
  role: text("role").notNull().default("user"),
  /** Set when a system administrator suspends the account. */
  disabledAt: timestamp("disabled_at"),
  /** Second factor at sign-in: a code by email (better-auth twoFactor). */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /** Product updates by email; opt-in at sign-up, off with one click from any announcement. */
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  /** Per-user override of PLAN_MAX_DATABASES; null means the plan default. */
  maxDatabases: integer("max_databases"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/** better-auth twoFactor plugin: one row per user with the factor on. */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until"),
  },
  (t) => [index("two_factor_user_id_idx").on(t.userId), index("two_factor_secret_idx").on(t.secret)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ------------------------------------------------------------------ platform

/** A user's database: one Denis project. The Denis token never leaves the server. */
export const databases = pgTable(
  "databases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    region: text("region").notNull().default("eu-central"),
    /** Denis project token (128 chars). */
    denisToken: text("denis_token").notNull(),
    maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
    maxKeys: integer("max_keys").notNull(),
    opsPerDay: integer("ops_per_day").notNull(),
    /** Last sampled usage, denormalised for list views. */
    cachedKeys: integer("cached_keys").notNull().default(0),
    cachedBytes: bigint("cached_bytes", { mode: "number" }).notNull().default(0),
    persistedKeys: integer("persisted_keys").notNull().default(0),
    persistedBytes: bigint("persisted_bytes", { mode: "number" }).notNull().default(0),
    usageSampledAt: timestamp("usage_sampled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("databases_user_id_idx").on(t.userId), uniqueIndex("databases_user_slug_idx").on(t.userId, t.slug)],
);

/** API keys grant programmatic and MCP access to one database. Only the hash is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First 12 characters, shown in lists so a key can be recognised. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    /** "read" or "write" (write implies read). */
    scope: text("scope").notNull().default("write"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("api_keys_database_id_idx").on(t.databaseId)],
);

/** Per-database, per-hour counters and usage snapshots for the charts and the daily ops quota. */
export const usageSamples = pgTable(
  "usage_samples",
  {
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    /** Start of the UTC hour. */
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    ops: integer("ops").notNull().default(0),
    reads: integer("reads").notNull().default(0),
    writes: integer("writes").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    /** Last snapshot inside the hour. */
    persistedBytes: bigint("persisted_bytes", { mode: "number" }).notNull().default(0),
    persistedKeys: integer("persisted_keys").notNull().default(0),
    cachedKeys: integer("cached_keys").notNull().default(0),
    /** Sum of round-trip latency in ms and count, for averages. */
    latencyMs: bigint("latency_ms", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("usage_samples_pk").on(t.databaseId, t.hour), index("usage_samples_hour_idx").on(t.hour)],
);

/** Roles shared by platform members and database-local accounts. */
export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Platform users who can open a database they do not own, with a role. */
export const databaseMembers = pgTable(
  "database_members",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("database_members_db_user_idx").on(t.databaseId, t.userId), index("database_members_user_idx").on(t.userId)],
);

/**
 * Accounts that exist only inside one database: they sign in at
 * /db/<id>/login with a username and password and never see the platform.
 */
export const databaseAccounts = pgTable(
  "database_accounts",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("editor"),
    lastLoginAt: timestamp("last_login_at"),
    disabledAt: timestamp("disabled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("database_accounts_db_username_idx").on(t.databaseId, t.username)],
);

/** Every command that went through the gateway: who ran what, and how it went. */
export const commandLog = pgTable(
  "command_log",
  {
    id: text("id").primaryKey(),
    databaseId: text("database_id")
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    /** user | account | apikey */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    /** What to show: a name, a username or a key name. */
    actorLabel: text("actor_label").notNull(),
    source: text("source").notNull(),
    command: text("command").notNull(),
    ok: boolean("ok").notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("command_log_db_time_idx").on(t.databaseId, t.createdAt)],
);

/** What happened to a database: creation, deletion, key creation, quota hits. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    databaseId: text("database_id").references(() => databases.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index("audit_log_user_id_idx").on(t.userId, t.createdAt)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  databases: many(databases),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const databasesRelations = relations(databases, ({ one, many }) => ({
  user: one(user, { fields: [databases.userId], references: [user.id] }),
  apiKeys: many(apiKeys),
  samples: many(usageSamples),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  database: one(databases, { fields: [apiKeys.databaseId], references: [databases.id] }),
}));

export const usageSamplesRelations = relations(usageSamples, ({ one }) => ({
  database: one(databases, { fields: [usageSamples.databaseId], references: [databases.id] }),
}));

export type Database = typeof databases.$inferSelect;
export type DatabaseMember = typeof databaseMembers.$inferSelect;
export type DatabaseAccount = typeof databaseAccounts.$inferSelect;
export type CommandLogRow = typeof commandLog.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type UsageSample = typeof usageSamples.$inferSelect;
