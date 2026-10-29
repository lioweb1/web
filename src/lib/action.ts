import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuth, hasRole, clientIp, type AuthContext, type Role } from "@/lib/auth/session";
import { audit } from "@/lib/services/audit";
import { LimitExceededError } from "@/lib/plans";
import { RateLimitError } from "@/lib/security/rate-limit";
import type { ActionState } from "./action-types";

export type { ActionState };

/** FormData → plain object. Repeated keys become arrays. */
export function formToObject(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || k.startsWith("$ACTION")) continue;
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/** Errors whose messages are safe to show to users. Anything else is logged and replaced. */
export class UserError extends Error {}

const SAFE = [UserError, LimitExceededError, RateLimitError];

export function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (e instanceof Error && (SAFE.some((C) => e instanceof C) || e.name === "ForbiddenError" || e.constructor.name === "ForbiddenError")) return e.message;
  if (e instanceof Error && !/Failed query|ECONN|password|relation|column|syntax error/i.test(e.message)) return e.message;
  console.error("[action error]", e);
  return "Unexpected error. Please try again.";
}

/**
 * Wrap a server action: authentication, role check, zod validation, safe error
 * messages and optional audit logging.
 */
export function action<S extends z.ZodType>(
  opts: { schema: S; role?: Role; audit?: string },
  fn: (ctx: AuthContext, input: z.infer<S>) => Promise<ActionState | void>,
) {
  return async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    const ctx = await getAuth();
    if (!ctx) return { error: "Your session has expired. Please sign in again." };
    if (opts.role && !hasRole(ctx, opts.role)) return { error: `This action requires the ${opts.role} role.` };
    try {
      const input = opts.schema.parse(formToObject(fd));
      const res = await fn(ctx, input);
      if (opts.audit) {
        await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: opts.audit, metadata: auditSafe(input), ip: clientIp(await headers()) });
      }
      return res ?? { ok: true };
    } catch (e) {
      if (isRedirect(e)) throw e;
      return { error: errorMessage(e) };
    }
  };
}

/** Same as `action` for plain `<form action>` usage without useActionState. */
export function simpleAction<S extends z.ZodType>(opts: { schema: S; role?: Role; audit?: string }, fn: (ctx: AuthContext, input: z.infer<S>) => Promise<unknown>) {
  const wrapped = action(opts, async (c, i) => {
    await fn(c, i);
  });
  return async (fd: FormData) => {
    const r = await wrapped(null, fd);
    if (r?.error) throw new UserError(r.error);
  };
}

function isRedirect(e: unknown) {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_");
}

function auditSafe(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([k]) => !/password|secret|token|key/i.test(k)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v]));
}

/* Common zod helpers for form fields */
export const zCsv = z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v : []), z.array(z.string()));
export const zArr = z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string()));
export const zBool = z.preprocess((v) => v === "on" || v === "1" || v === "true", z.boolean());
export const zInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
export const zOptDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable());
export const zUuid = z.string().uuid();
