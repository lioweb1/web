import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, tx, type Db } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "mc_session";
export const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  org: {
    id: string;
    name: string;
    plan: string;
    subscription_status: string | null;
    stripe_customer_id: string | null;
    trial_credits: number;
    plan_credits: number;
    purchased_credits: number;
    current_period_end: Date | null;
  };
};

export async function createSession(userId: string, c?: Db): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await (c ?? (await db())).query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [sha256(token), userId, expires]);
  return { token, expires };
}

export async function deleteSession(token: string): Promise<void> {
  await (await db()).query("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await (await db()).query(
    `select u.id, u.email, u.name, u.role,
            o.id as org_id, o.name as org_name, o.plan, o.subscription_status, o.stripe_customer_id,
            o.trial_credits, o.plan_credits, o.purchased_credits, o.current_period_end
       from sessions s join users u on u.id = s.user_id join orgs o on o.id = u.org_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    org: {
      id: r.org_id,
      name: r.org_name,
      plan: r.plan,
      subscription_status: r.subscription_status,
      stripe_customer_id: r.stripe_customer_id,
      trial_credits: r.trial_credits,
      plan_credits: r.plan_credits,
      purchased_credits: r.purchased_credits,
      current_period_end: r.current_period_end,
    },
  };
}

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signUp(input: { email: string; password: string; name: string; firm: string }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 120);
  const firm = input.firm.trim().slice(0, 160);
  if (!EMAIL_RE.test(email) || email.length > 254) throw new AuthError("Enter a valid email address.");
  if (!name || !firm) throw new AuthError("Name and firm are required.");
  if (input.password.length < 10) throw new AuthError("Password must be at least 10 characters.");
  if (input.password.length > 200) throw new AuthError("Password is too long.");
  const hash = await hashPassword(input.password);
  return tx(async (c) => {
    const exists = await c.query("select 1 from users where lower(email) = $1", [email]);
    if (exists.rowCount) throw new AuthError("An account with this email already exists.", 409);
    const org = await c.query("insert into orgs (name) values ($1) returning id", [firm]);
    const user = await c.query("insert into users (org_id, email, name, password_hash, role) values ($1, $2, $3, $4, 'owner') returning id", [org.rows[0].id, email, name, hash]);
    await c.query("insert into usage_events (org_id, user_id, kind, credits, note) values ($1, $2, 'adjustment', 1, 'Free trial credit')", [org.rows[0].id, user.rows[0].id]);
    return createSession(user.rows[0].id, c);
  });
}

const MAX_ATTEMPTS = 8;
const WINDOW_MIN = 15;

export async function logIn(emailIn: string, password: string, ip: string) {
  const email = emailIn.trim().toLowerCase();
  const c = await db();
  const keys = [`email:${email}`, `ip:${ip}`];
  const { rows } = await c.query(
    `select key, count(*)::int as n from login_attempts where key = any($1) and at > now() - interval '${WINDOW_MIN} minutes' group by key`,
    [keys],
  );
  if (rows.some((r) => r.n >= (r.key.startsWith("ip:") ? MAX_ATTEMPTS * 4 : MAX_ATTEMPTS))) {
    throw new AuthError(`Too many attempts. Try again in ${WINDOW_MIN} minutes.`, 429);
  }
  const u = await c.query("select id, password_hash from users where lower(email) = $1", [email]);
  // Hash even when the user doesn't exist so timing doesn't reveal which emails are registered.
  const ok = await verifyPassword(password, u.rows[0]?.password_hash ?? "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!u.rows[0] || !ok) {
    await c.query("insert into login_attempts (key) values ($1), ($2)", keys);
    await c.query("delete from login_attempts where at < now() - interval '1 day'");
    throw new AuthError("Incorrect email or password.", 401);
  }
  await c.query("delete from login_attempts where key = $1", [keys[0]]);
  return createSession(u.rows[0].id);
}

/** Rejects cross-site requests to state-changing endpoints (defense in depth on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, expires: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

export function requestUser(req: Request): Promise<SessionUser | null> {
  return userFromToken(readCookie(req, SESSION_COOKIE));
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
