import { and, eq, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { schema, systemDb, withTenant } from "@/lib/db";
import type { BotLicenseFeatures, BotStatusSummary } from "@/lib/db/schema";

export const BOT_PLANS = ["trial", "monthly", "yearly", "lifetime"] as const;
export type BotPlan = (typeof BOT_PLANS)[number];
export const BOT_BROKERS = ["deriv", "browser", "extension", "paper"] as const;

/* ------------------------------------------------------------------ */
/* License keys                                                         */
/* ------------------------------------------------------------------ */

/** Unambiguous alphabet: no 0/O, 1/I/L. */
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KEY_RE = /^BB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function generateLicenseKey(): string {
  const group = () => Array.from({ length: 4 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join("");
  return `BB-${group()}-${group()}-${group()}-${group()}`;
}

/** Accepts "bb xxxx xxxx…", lowercase, stray spaces; returns the canonical key or null. */
export function normalizeLicenseKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  if (KEY_RE.test(compact)) return compact;
  const bare = compact.replace(/-/g, "");
  if (/^BB[A-Z0-9]{16}$/.test(bare)) return `BB-${bare.slice(2, 6)}-${bare.slice(6, 10)}-${bare.slice(10, 14)}-${bare.slice(14, 18)}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Pure validation                                                      */
/* ------------------------------------------------------------------ */

export type LicenseDenial = "not_found" | "revoked" | "expired" | "device_limit";

export type LicenseLike = { status: string; expiresAt: Date | null; maxDevices: number };

/**
 * Decide whether `machineId` may use the license. `knownMachines` are the machine ids
 * already registered on it. Pure so it is unit-testable without a database.
 */
export function evaluateLicense(lic: LicenseLike | null | undefined, knownMachines: string[], machineId: string, now = new Date()): { ok: true; newDevice: boolean } | { ok: false; reason: LicenseDenial } {
  if (!lic) return { ok: false, reason: "not_found" };
  if (lic.status === "revoked") return { ok: false, reason: "revoked" };
  if (lic.status === "expired" || (lic.expiresAt && lic.expiresAt.getTime() <= now.getTime())) return { ok: false, reason: "expired" };
  if (knownMachines.includes(machineId)) return { ok: true, newDevice: false };
  if (knownMachines.length >= lic.maxDevices) return { ok: false, reason: "device_limit" };
  return { ok: true, newDevice: true };
}

/* ------------------------------------------------------------------ */
/* Bot-facing (license key auth, owner connection scoped by license)    */
/* ------------------------------------------------------------------ */

export type DeviceInfo = { machineId: string; hostname?: string | null; version?: string | null; broker?: string | null };

export type ValidateResult =
  | { valid: true; licenseId: string; deviceId: string; plan: string; expiresAt: Date | null; features: BotLicenseFeatures; label: string }
  | { valid: false; reason: LicenseDenial };

/**
 * Validate a key for a device and register/touch the device. Uses the owner connection
 * because the bot has no session; every query is scoped to the single license row.
 */
export async function validateLicense(rawKey: unknown, device: DeviceInfo, now = new Date()): Promise<ValidateResult> {
  const key = normalizeLicenseKey(rawKey);
  if (!key || !device.machineId) return { valid: false, reason: "not_found" };
  const db = systemDb();
  const L = schema.botLicenses;
  const D = schema.botDevices;
  const [lic] = await db.select().from(L).where(eq(L.key, key)).limit(1);
  if (!lic) return { valid: false, reason: "not_found" };
  const devices = await db.select({ id: D.id, machineId: D.machineId }).from(D).where(eq(D.licenseId, lic.id));
  const verdict = evaluateLicense(lic, devices.map((d) => d.machineId), device.machineId, now);
  if (!verdict.ok) {
    if (verdict.reason === "expired" && lic.status === "active") await db.update(L).set({ status: "expired" }).where(eq(L.id, lic.id));
    return { valid: false, reason: verdict.reason };
  }
  const meta = { hostname: device.hostname?.slice(0, 120) ?? null, version: device.version?.slice(0, 40) ?? null, broker: device.broker?.slice(0, 40) ?? null, lastSeenAt: now };
  const [dev] = await db
    .insert(D)
    .values({ licenseId: lic.id, machineId: device.machineId.slice(0, 120), ...meta })
    .onConflictDoUpdate({ target: [D.licenseId, D.machineId], set: Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== null)) })
    .returning({ id: D.id });
  await db.update(L).set({ lastSeenAt: now }).where(eq(L.id, lic.id));
  return { valid: true, licenseId: lic.id, deviceId: dev.id, plan: lic.plan, expiresAt: lic.expiresAt, features: lic.features, label: lic.label };
}

export type TradeInput = {
  traded_at: number;
  symbol: string;
  direction: "CALL" | "PUT";
  stake: number;
  confidence?: number | null;
  outcome: "win" | "loss" | "tie" | "unknown";
  pnl: number;
  ref?: string | null;
  strategy?: string | null;
  broker?: string | null;
  reasons?: string[];
};

/** Insert trades for a license; re-sent trades with the same ref are ignored. Returns how many were new. */
export async function ingestTrades(licenseId: string, deviceId: string | null, trades: TradeInput[]): Promise<number> {
  if (!trades.length) return 0;
  const T = schema.botTrades;
  const rows = trades.map((t) => ({
    licenseId,
    deviceId,
    tradedAt: new Date(t.traded_at * 1000),
    symbol: t.symbol.slice(0, 40),
    direction: t.direction,
    stake: t.stake,
    confidence: t.confidence ?? null,
    outcome: t.outcome,
    pnl: t.pnl,
    ref: t.ref ? t.ref.slice(0, 120) : null,
    strategy: t.strategy?.slice(0, 60) ?? null,
    broker: t.broker?.slice(0, 40) ?? null,
    reasons: (t.reasons ?? []).slice(0, 20).map((r) => String(r).slice(0, 200)),
  }));
  const inserted = await systemDb().insert(T).values(rows).onConflictDoNothing({ target: [T.licenseId, T.ref], where: sql`${T.ref} is not null` }).returning({ id: T.id });
  return inserted.length;
}

export type StatusInput = { balance?: number | null; summary?: BotStatusSummary; config?: Record<string, unknown>; version?: string | null; broker?: string | null };

export async function ingestStatus(deviceId: string, status: StatusInput, now = new Date()) {
  const S = schema.botStatus;
  const D = schema.botDevices;
  const values = { deviceId, balance: status.balance ?? null, summary: status.summary ?? {}, config: status.config ?? {}, updatedAt: now };
  await systemDb().insert(S).values(values).onConflictDoUpdate({ target: S.deviceId, set: { balance: values.balance, summary: values.summary, config: values.config, updatedAt: now } });
  const touch: Record<string, unknown> = { lastSeenAt: now };
  if (status.version) touch.version = status.version.slice(0, 40);
  if (status.broker) touch.broker = status.broker.slice(0, 40);
  await systemDb().update(D).set(touch).where(eq(D.id, deviceId));
}

/* ------------------------------------------------------------------ */
/* Workspace-facing (session + RLS)                                     */
/* ------------------------------------------------------------------ */

export type LicenseInput = {
  label: string;
  plan: BotPlan;
  maxDevices: number;
  expiresAt: Date | null;
  features: BotLicenseFeatures;
  notes?: string | null;
};

export function planDuration(plan: BotPlan, now = new Date()): Date | null {
  const days = plan === "trial" ? 7 : plan === "monthly" ? 30 : plan === "yearly" ? 365 : null;
  return days === null ? null : new Date(now.getTime() + days * 86400_000);
}

export async function createLicense(workspaceId: string, input: LicenseInput) {
  if (!input.label.trim()) throw new Error("Label is required");
  if (!BOT_PLANS.includes(input.plan)) throw new Error("Unknown plan");
  return withTenant(workspaceId, async (tx) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = generateLicenseKey();
      const [row] = await tx
        .insert(schema.botLicenses)
        .values({ workspaceId, key, label: input.label.trim().slice(0, 120), plan: input.plan, maxDevices: Math.max(1, Math.min(50, input.maxDevices)), expiresAt: input.expiresAt, features: input.features, notes: input.notes?.slice(0, 2000) ?? null })
        .onConflictDoNothing({ target: schema.botLicenses.key })
        .returning();
      if (row) return row;
    }
    throw new Error("Could not generate a unique key");
  });
}

export async function setLicenseStatus(workspaceId: string, licenseId: string, status: "active" | "revoked") {
  return withTenant(workspaceId, async (tx) => {
    const [lic] = await tx.select().from(schema.botLicenses).where(eq(schema.botLicenses.id, licenseId));
    if (!lic) throw new Error("License not found");
    const set: Partial<typeof lic> = { status };
    // Reactivating an expired key without a new date would expire again immediately.
    if (status === "active" && lic.expiresAt && lic.expiresAt.getTime() <= Date.now()) set.expiresAt = planDuration(lic.plan as BotPlan) ?? null;
    await tx.update(schema.botLicenses).set(set).where(eq(schema.botLicenses.id, licenseId));
  });
}

export async function extendLicense(workspaceId: string, licenseId: string, days: number) {
  return withTenant(workspaceId, async (tx) => {
    const [lic] = await tx.select().from(schema.botLicenses).where(eq(schema.botLicenses.id, licenseId));
    if (!lic) throw new Error("License not found");
    const base = lic.expiresAt && lic.expiresAt.getTime() > Date.now() ? lic.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + days * 86400_000);
    await tx.update(schema.botLicenses).set({ expiresAt, status: lic.status === "expired" ? "active" : lic.status }).where(eq(schema.botLicenses.id, licenseId));
    return expiresAt;
  });
}

export async function updateLicenseNotes(workspaceId: string, licenseId: string, notes: string | null) {
  return withTenant(workspaceId, (tx) => tx.update(schema.botLicenses).set({ notes }).where(eq(schema.botLicenses.id, licenseId)));
}

export async function deleteDevice(workspaceId: string, licenseId: string, deviceId: string) {
  return withTenant(workspaceId, (tx) => tx.delete(schema.botDevices).where(and(eq(schema.botDevices.id, deviceId), eq(schema.botDevices.licenseId, licenseId))));
}

export async function deleteLicense(workspaceId: string, licenseId: string) {
  return withTenant(workspaceId, (tx) => tx.delete(schema.botLicenses).where(eq(schema.botLicenses.id, licenseId)));
}

/** Effective status for display: "active" keys past their date read as expired. */
export function effectiveStatus(lic: { status: string; expiresAt: Date | null }, now = new Date()): "active" | "revoked" | "expired" {
  if (lic.status === "revoked") return "revoked";
  if (lic.status === "expired" || (lic.expiresAt && lic.expiresAt.getTime() <= now.getTime())) return "expired";
  return "active";
}
