import { z } from "zod";

/**
 * Environment, validated once at start-up so a missing secret fails loudly
 * instead of producing a half-working deployment. See .env.example.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 3600),
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  DENIS_HOST: z.string().default("127.0.0.1"),
  DENIS_PORT: z.coerce.number().int().positive().default(5142),
  DENIS_GROUP: z.string().min(1),
  DENIS_PASSWORD: z.string().min(1),
  DENIS_MAIN_TOKEN: z.string().length(128, "DENIS_MAIN_TOKEN must be the server's 128-character main token"),
  /** Outgoing mail: Resend first, then SMTP (smtp://user:pass@host:587), otherwise the server log. */
  RESEND_API_KEY: z.string().optional().default(""),
  SMTP_URL: z.string().optional().default(""),
  MAIL_FROM: z.string().default("Denis Cloud <denis@hacimertgokhan.com>"),
  /** Cloudflare Turnstile, optional; the honeypot and timing checks run regardless. */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional().default(""),
  TURNSTILE_SECRET_KEY: z.string().optional().default(""),
  /** Who operates the service, for the legal pages (the data controller). */
  LEGAL_ENTITY: z.string().default("Hacı Mert Gökhan"),
  LEGAL_CONTACT_EMAIL: z.string().default("hacimertgokhan@gmail.com"),
  LEGAL_ADDRESS: z.string().default(""),
  /** Comma-separated emails that are always system administrators. */
  PLATFORM_ADMINS: z.string().default("hacimertgokhan@gmail.com"),
  PLAN_MAX_DATABASES: z.coerce.number().int().positive().default(3),
  PLAN_DB_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  PLAN_DB_MAX_KEYS: z.coerce.number().int().positive().default(50_000),
  PLAN_DB_OPS_PER_DAY: z.coerce.number().int().positive().default(100_000),
  PLAN_API_RATE_PER_MINUTE: z.coerce.number().int().positive().default(600),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    throw new Error("Invalid environment: JWT_REFRESH_SECRET must differ from JWT_SECRET");
  }
  cached = parsed.data;
  return cached;
}

/** The plan every user is on; a single free tier for now. */
export function plan() {
  const e = env();
  return {
    name: "free",
    maxDatabases: e.PLAN_MAX_DATABASES,
    dbMaxBytes: e.PLAN_DB_MAX_BYTES,
    dbMaxKeys: e.PLAN_DB_MAX_KEYS,
    dbOpsPerDay: e.PLAN_DB_OPS_PER_DAY,
    apiRatePerMinute: e.PLAN_API_RATE_PER_MINUTE,
  };
}
