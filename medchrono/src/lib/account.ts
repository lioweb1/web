import { AuthError, createSession, hashPassword, validatePassword } from "./auth";
import { db, tx } from "./db";
import { buttonEmail, emailConfigured, sendEmail } from "./email";
import { hashToken, newToken } from "./tokens";
import { TERMS_VERSION } from "./legal";

const RESET_TTL_MIN = 60;
const INVITE_TTL_DAYS = 7;
const RESET_PER_HOUR = 3;

/* ------------------------------ password reset ------------------------------ */

/**
 * Emails a single-use reset link if the address has an account.
 * Always resolves the same way so the response never reveals whether an email is registered.
 */
export async function requestPasswordReset(emailIn: string, baseUrl: string): Promise<void> {
  const email = emailIn.trim().toLowerCase();
  const c = await db();
  const { rows } = await c.query("select id, name from users where lower(email) = $1", [email]);
  const u = rows[0];
  if (!u) return;
  const recent = await c.query("select count(*)::int as n from password_resets where user_id = $1 and created_at > now() - interval '1 hour'", [u.id]);
  if (recent.rows[0].n >= RESET_PER_HOUR) return;
  const token = newToken();
  await c.query("insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))", [hashToken(token), u.id, RESET_TTL_MIN]);
  const url = `${baseUrl}/reset-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: "Reset your MedChrono AI password",
    ...buttonEmail({
      heading: "Reset your password",
      intro: `Hi ${u.name}, we received a request to reset the password for your MedChrono AI account.`,
      button: "Choose a new password",
      url,
      footer: `This link expires in ${RESET_TTL_MIN} minutes and can be used once. If you didn't ask for this, you can ignore this email — your password won't change.`,
    }),
  });
}

/** Sets a new password from a reset token, signs out every other session, and returns a fresh session. */
export async function resetPassword(token: string, password: string) {
  validatePassword(password);
  const hash = await hashPassword(password);
  return tx(async (c) => {
    const { rows } = await c.query(
      "update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id",
      [hashToken(token)],
    );
    if (!rows[0]) throw new AuthError("This reset link is invalid or has expired. Request a new one.", 400);
    const userId = rows[0].user_id;
    await c.query("update users set password_hash = $2 where id = $1", [userId, hash]);
    await c.query("delete from sessions where user_id = $1", [userId]);
    await c.query("update password_resets set used_at = now() where user_id = $1 and used_at is null", [userId]);
    await c.query("delete from login_attempts where key = (select 'email:' || lower(email) from users where id = $1)", [userId]);
    return createSession(userId, c);
  });
}

/* ---------------------------------- team ----------------------------------- */

export function seatLimit(plan: string): number {
  return plan === "enterprise" ? 500 : plan === "firm" ? 10 : 3;
}

export type Member = { id: string; name: string; email: string; role: string; created_at: Date };
export type PendingInvite = { id: string; email: string; role: string; created_at: Date; expires_at: Date; invited_by: string | null };

export async function teamOverview(orgId: string): Promise<{ members: Member[]; invites: PendingInvite[] }> {
  const c = await db();
  const members = await c.query("select id, name, email, role, created_at from users where org_id = $1 order by created_at", [orgId]);
  const invites = await c.query(
    `select i.id, i.email, i.role, i.created_at, i.expires_at, u.name as invited_by
       from invites i left join users u on u.id = i.invited_by
      where i.org_id = $1 and i.accepted_at is null and i.expires_at > now() order by i.created_at desc`,
    [orgId],
  );
  return { members: members.rows, invites: invites.rows };
}

function requireOwner(role: string) {
  if (role !== "owner") throw new AuthError("Only account owners can manage the team.", 403);
}

export async function inviteMember(
  inviter: { id: string; name: string; role: string; org: { id: string; name: string; plan: string } },
  emailIn: string,
  role: string,
  baseUrl: string,
): Promise<{ url: string; emailed: boolean }> {
  requireOwner(inviter.role);
  const email = emailIn.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  if (role !== "member" && role !== "owner") throw new AuthError("Unknown role.");
  const token = newToken();
  await tx(async (c) => {
    await c.query("select 1 from orgs where id = $1 for update", [inviter.org.id]);
    const existing = await c.query("select org_id from users where lower(email) = $1", [email]);
    if (existing.rows[0]) {
      throw new AuthError(existing.rows[0].org_id === inviter.org.id ? "This person is already on your team." : "This email already has a MedChrono account with another firm.", 409);
    }
    const seats = await c.query(
      `select (select count(*) from users where org_id = $1)::int
            + (select count(*) from invites where org_id = $1 and accepted_at is null and expires_at > now() and lower(email) <> $2)::int as n`,
      [inviter.org.id, email],
    );
    const limit = seatLimit(inviter.org.plan);
    if (seats.rows[0].n >= limit) throw new AuthError(`Your plan includes ${limit} users. Upgrade or remove someone to invite more.`, 402);
    // Re-inviting the same email replaces the old link.
    await c.query("delete from invites where org_id = $1 and lower(email) = $2 and accepted_at is null", [inviter.org.id, email]);
    await c.query(
      "insert into invites (org_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))",
      [inviter.org.id, email, role, hashToken(token), inviter.id, INVITE_TTL_DAYS],
    );
  });
  const url = `${baseUrl}/invite?token=${token}`;
  await sendEmail({
    to: email,
    subject: `${inviter.name} invited you to ${inviter.org.name} on MedChrono AI`,
    ...buttonEmail({
      heading: `Join ${inviter.org.name} on MedChrono AI`,
      intro: `${inviter.name} invited you to review medical records with the ${inviter.org.name} team on MedChrono AI.`,
      button: "Accept invitation",
      url,
      footer: `This invitation expires in ${INVITE_TTL_DAYS} days.`,
    }),
  });
  return { url, emailed: emailConfigured() };
}

export async function revokeInvite(actor: { role: string; org: { id: string } }, inviteId: string): Promise<void> {
  requireOwner(actor.role);
  await (await db()).query("delete from invites where id = $1 and org_id = $2 and accepted_at is null", [inviteId, actor.org.id]);
}

export async function removeMember(actor: { id: string; role: string; org: { id: string } }, userId: string): Promise<void> {
  requireOwner(actor.role);
  if (userId === actor.id) throw new AuthError("You can't remove yourself.");
  await tx(async (c) => {
    const { rows } = await c.query("select role from users where id = $1 and org_id = $2 for update", [userId, actor.org.id]);
    if (!rows[0]) throw new AuthError("Member not found.", 404);
    await c.query("delete from users where id = $1", [userId]); // sessions cascade
  });
}

export async function changeRole(actor: { id: string; role: string; org: { id: string } }, userId: string, role: string): Promise<void> {
  requireOwner(actor.role);
  if (role !== "member" && role !== "owner") throw new AuthError("Unknown role.");
  await tx(async (c) => {
    await c.query("select 1 from orgs where id = $1 for update", [actor.org.id]);
    const r = await c.query("update users set role = $3 where id = $1 and org_id = $2 returning id", [userId, actor.org.id, role]);
    if (!r.rowCount) throw new AuthError("Member not found.", 404);
    const owners = await c.query("select count(*)::int as n from users where org_id = $1 and role = 'owner'", [actor.org.id]);
    if (owners.rows[0].n === 0) throw new AuthError("A firm needs at least one owner.");
  });
}

export async function inviteInfo(token: string): Promise<{ email: string; org: string; inviter: string | null } | null> {
  const { rows } = await (await db()).query(
    `select i.email, o.name as org, u.name as inviter from invites i join orgs o on o.id = i.org_id left join users u on u.id = i.invited_by
      where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/** Creates the invited user's account in the inviting firm and signs them in. */
export async function acceptInvite(token: string, input: { name: string; password: string; acceptTerms: boolean }) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new AuthError("Enter your name.");
  if (!input.acceptTerms) throw new AuthError("Please accept the Terms of Service and Privacy Policy.");
  validatePassword(input.password);
  const hash = await hashPassword(input.password);
  return tx(async (c) => {
    const { rows } = await c.query(
      "update invites set accepted_at = now() where token_hash = $1 and accepted_at is null and expires_at > now() returning org_id, email, role",
      [hashToken(token)],
    );
    const inv = rows[0];
    if (!inv) throw new AuthError("This invitation is invalid, expired or already used.", 400);
    const exists = await c.query("select 1 from users where lower(email) = lower($1)", [inv.email]);
    if (exists.rowCount) throw new AuthError("This email already has a MedChrono account. Sign in instead.", 409);
    const u = await c.query(
      "insert into users (org_id, email, name, password_hash, role, terms_version, terms_accepted_at) values ($1, $2, $3, $4, $5, $6, now()) returning id",
      [inv.org_id, inv.email, name, hash, inv.role, TERMS_VERSION],
    );
    return createSession(u.rows[0].id, c);
  });
}
