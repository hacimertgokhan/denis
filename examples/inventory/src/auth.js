import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { denis } from "./denis.js";

/**
 * Accounts and sessions as keys in Denis. Passwords are scrypt hashes with a
 * random salt; a session is a random token that maps to the email and an
 * expiry, persisted so a restart keeps everyone signed in.
 */
const SESSION_DAYS = 14;
const COOKIE = "inv_session";

function hash(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

export async function findUser(email) {
  return denis.getJSON(`user:${email.toLowerCase()}`);
}

export async function createUser({ email, name, password, role = "staff" }) {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
  if (password.length < 8) throw new Error("Passwords need at least 8 characters");
  if (await findUser(email)) throw new Error("An account with that email already exists");
  const salt = randomBytes(16).toString("hex");
  const user = { email, name: name.trim() || email.split("@")[0], salt, hash: hash(password, salt), role, createdAt: new Date().toISOString() };
  await denis.set(`user:${email}`, user, { persist: true });
  return user;
}

export async function verifyUser(email, password) {
  const user = await findUser(email);
  if (!user) return null;
  const candidate = Buffer.from(hash(password, user.salt), "hex");
  const expected = Buffer.from(user.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected) ? user : null;
}

export async function countUsers() {
  return (await denis.keys("user:*")).length;
}

export async function createSession(email) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  await denis.set(`session:${token}`, { email, expiresAt }, { persist: true });
  return { token, expiresAt };
}

export async function readSession(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await denis.getJSON(`session:${token}`);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await denis.del(`session:${token}`);
    return null;
  }
  return findUser(session.email);
}

export async function destroySession(token) {
  if (token) await denis.del(`session:${token}`).catch(() => {});
}

/** Express middleware: `req.user` from the cookie, or null. */
export function attachUser() {
  return async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.sessionToken = token;
    req.user = await readSession(token);
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: new Date(expiresAt), path: "/" });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
      }),
  );
}
