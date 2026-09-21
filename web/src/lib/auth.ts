import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { captcha, emailOTP, twoFactor } from "better-auth/plugins";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { newSignInMail, passwordResetMail, sendMail, signInCodeMail, verificationCodeMail } from "@/lib/mail";
import { and, eq, ne } from "drizzle-orm";

const e = env();

/**
 * Bot protection without a third party: the sign-up and reset forms carry
 * a honeypot field and the moment the form was opened. A filled honeypot or
 * a form submitted within two seconds of opening is a script, not a person.
 * When Cloudflare Turnstile keys are configured, the captcha plugin verifies
 * its token on top of this.
 */
const PROTECTED_PATHS = new Set(["/sign-up/email", "/request-password-reset", "/email-otp/send-verification-otp"]);
const OTP_MINUTES = 10;
const MIN_FORM_MS = 2000;

const humanCheck = createAuthMiddleware(async (ctx) => {
  if (!PROTECTED_PATHS.has(ctx.path)) return;
  const honeypot = ctx.headers?.get("x-form-website") ?? "";
  const started = Number(ctx.headers?.get("x-form-started") ?? 0);
  if (honeypot.trim() !== "") throw new APIError("BAD_REQUEST", { message: "That did not work. Please try again." });
  if (!started || Date.now() - started < MIN_FORM_MS) throw new APIError("BAD_REQUEST", { message: "Please take a moment and try again." });
});

export const auth = betterAuth({
  appName: "Denis Cloud",
  baseURL: e.NEXT_PUBLIC_APP_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
    },
  }),
  databaseHooks: {
    session: {
      create: {
        // A session from a browser this account has not used before gets a
        // notice by mail: when, from where, and what to do if it was not you.
        after: async (session) => {
          try {
            const [known] = await db
              .select({ id: schema.session.id })
              .from(schema.session)
              .where(and(eq(schema.session.userId, session.userId), ne(schema.session.id, session.id), eq(schema.session.userAgent, session.userAgent ?? "")))
              .limit(1);
            if (known) return;
            const [row] = await db
              .select({ email: schema.user.email, name: schema.user.name })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);
            if (!row) return;
            void sendMail(
              newSignInMail(row.email, { at: session.createdAt ?? new Date(), ip: session.ipAddress ?? null, userAgent: session.userAgent ?? null }),
            ).catch((err) => console.error("[mail] new sign-in:", err));
          } catch (err) {
            console.error("[auth] new sign-in notice:", err);
          }
        },
      },
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      disabledAt: { type: "date", required: false, input: false },
      maxDatabases: { type: "number", required: false, input: false },
      // the one field a person sets at sign-up: product updates, off by default
      marketingOptIn: { type: "boolean", defaultValue: false, input: true },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // "Forgot password": a one-hour link by mail (or the server log without SMTP)
    sendResetPassword: async ({ user, url }) => {
      void sendMail(passwordResetMail(user.email, url)).catch((err) => console.error("[mail] reset password:", err));
    },
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
  },
  hooks: { before: humanCheck },
  // On in every environment (better-auth only enables it in production by default).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 10 },
      "/request-password-reset": { window: 600, max: 3 },
      "/email-otp/send-verification-otp": { window: 600, max: 5 },
      "/email-otp/verify-email": { window: 600, max: 10 },
      "/sign-in/email-otp": { window: 600, max: 10 },
      "/two-factor/send-otp": { window: 600, max: 5 },
      "/two-factor/verify-otp": { window: 600, max: 10 },
      "/two-factor/verify-backup-code": { window: 600, max: 5 },
      "/reset-password": { window: 600, max: 5 },
    },
  },
  socialProviders:
    e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET ? { github: { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET } } : undefined,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [
    nextCookies(),
    // second factor by mail: on for accounts that turned it on under Settings -> Security
    twoFactor({
      skipVerificationOnEnable: true,
      otpOptions: {
        period: OTP_MINUTES,
        async sendOTP({ user, otp }) {
          void sendMail(signInCodeMail(user.email, otp, OTP_MINUTES)).catch((err) => console.error("[mail] 2fa:", err));
        },
      },
    }),
    // six-digit codes by mail: confirm the address after sign-up, or sign in without a password
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_MINUTES * 60,
      allowedAttempts: 5,
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      disableSignUp: true,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        const message = type === "sign-in" ? signInCodeMail(email, otp, OTP_MINUTES) : verificationCodeMail(email, otp, OTP_MINUTES);
        void sendMail(message).catch((err) => console.error("[mail] otp:", err));
      },
    }),
    ...(e.TURNSTILE_SECRET_KEY
      ? [captcha({ provider: "cloudflare-turnstile", secretKey: e.TURNSTILE_SECRET_KEY, endpoints: ["/sign-up/email", "/request-password-reset"] })]
      : []),
  ],
});

export type Session = typeof auth.$Infer.Session;
