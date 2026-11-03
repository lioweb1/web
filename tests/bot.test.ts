import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { createLicense, evaluateLicense, extendLicense, generateLicenseKey, ingestStatus, ingestTrades, normalizeLicenseKey, planDuration, setLicenseStatus, validateLicense, effectiveStatus } from "@/lib/services/bot";
import { getBotOverview, getLicenseDetail, listLicenses, parseBotFilter } from "@/lib/queries/bot";
import { POST as validatePost } from "@/app/api/bot/license/validate/route";
import { POST as ingestPost } from "@/app/api/bot/ingest/route";
import { makeUser } from "./helpers/db";

const DAY = 86400_000;

describe("license keys", () => {
  it("generates BB-XXXX-XXXX-XXXX-XXXX keys from an unambiguous alphabet", () => {
    const keys = new Set(Array.from({ length: 200 }, generateLicenseKey));
    expect(keys.size).toBe(200);
    for (const k of keys) {
      expect(k).toMatch(/^BB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("normalises user-typed keys and rejects garbage", () => {
    expect(normalizeLicenseKey("bb-abcd-efgh-jkmn-pqrs")).toBe("BB-ABCD-EFGH-JKMN-PQRS");
    expect(normalizeLicenseKey("  BB ABCD EFGH JKMN PQRS ")).toBe("BB-ABCD-EFGH-JKMN-PQRS");
    expect(normalizeLicenseKey("BBABCDEFGHJKMNPQRS")).toBe("BB-ABCD-EFGH-JKMN-PQRS");
    expect(normalizeLicenseKey("BB-ABCD-EFGH")).toBeNull();
    expect(normalizeLicenseKey("XX-ABCD-EFGH-JKMN-PQRS")).toBeNull();
    expect(normalizeLicenseKey(42)).toBeNull();
    expect(normalizeLicenseKey("BB-ABCD-EFGH-JKMN-PQR$")).toBeNull();
  });
});

describe("evaluateLicense (pure)", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const active = { status: "active", expiresAt: new Date(now.getTime() + DAY), maxDevices: 2 };

  it("handles not found / revoked / expired", () => {
    expect(evaluateLicense(null, [], "m1", now)).toEqual({ ok: false, reason: "not_found" });
    expect(evaluateLicense({ ...active, status: "revoked" }, [], "m1", now)).toEqual({ ok: false, reason: "revoked" });
    expect(evaluateLicense({ ...active, status: "expired" }, [], "m1", now)).toEqual({ ok: false, reason: "expired" });
    expect(evaluateLicense({ ...active, expiresAt: new Date(now.getTime() - 1) }, [], "m1", now)).toEqual({ ok: false, reason: "expired" });
    expect(evaluateLicense({ ...active, expiresAt: null }, [], "m1", now)).toEqual({ ok: true, newDevice: true });
  });

  it("enforces the device limit but always lets a known device back in", () => {
    expect(evaluateLicense(active, ["m1"], "m2", now)).toEqual({ ok: true, newDevice: true });
    expect(evaluateLicense(active, ["m1", "m2"], "m3", now)).toEqual({ ok: false, reason: "device_limit" });
    expect(evaluateLicense(active, ["m1", "m2"], "m2", now)).toEqual({ ok: true, newDevice: false });
  });

  it("plan durations and effective status", () => {
    expect(planDuration("lifetime")).toBeNull();
    expect(Math.round((planDuration("trial", now)!.getTime() - now.getTime()) / DAY)).toBe(7);
    expect(Math.round((planDuration("monthly", now)!.getTime() - now.getTime()) / DAY)).toBe(30);
    expect(Math.round((planDuration("yearly", now)!.getTime() - now.getTime()) / DAY)).toBe(365);
    expect(effectiveStatus({ status: "active", expiresAt: new Date(now.getTime() - 1) }, now)).toBe("expired");
    expect(effectiveStatus({ status: "revoked", expiresAt: null }, now)).toBe("revoked");
    expect(effectiveStatus({ status: "active", expiresAt: null }, now)).toBe("active");
  });

  it("parses dashboard filters safely", () => {
    const f = parseBotFilter({ range: "7", license: "not-a-uuid", symbol: " EURUSD ", outcome: "bogus" });
    expect(f.preset).toBe("7");
    expect(f.license).toBeNull();
    expect(f.symbol).toBe("EURUSD");
    expect(f.outcome).toBeNull();
    expect(parseBotFilter({ outcome: "win", license: "0f8fad5b-d9cb-469f-a165-70867728950e" })).toMatchObject({ outcome: "win", license: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  });
});

describe("license lifecycle against the database", () => {
  let ws: string;
  let key: string;
  let licenseId: string;
  beforeAll(async () => {
    ws = (await makeUser("Bot Admin")).workspace.id;
    const lic = await createLicense(ws, { label: "Customer A", plan: "monthly", maxDevices: 1, expiresAt: planDuration("monthly"), features: { auto_trade: true, max_symbols: 3, brokers: ["deriv"] }, notes: "paid by USDT" });
    key = lic.key;
    licenseId = lic.id;
  });

  it("validates, registers the device and returns features", async () => {
    const r = await validateLicense(key.toLowerCase(), { machineId: "machine-1", hostname: "pc-1", version: "0.1.0", broker: "deriv" });
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.plan).toBe("monthly");
    expect(r.features).toEqual({ auto_trade: true, max_symbols: 3, brokers: ["deriv"] });
    const again = await validateLicense(key, { machineId: "machine-1" });
    expect(again.valid && again.deviceId).toBe(r.deviceId);
    const [lic] = await systemDb().select().from(schema.botLicenses).where(eq(schema.botLicenses.id, licenseId));
    expect(lic.lastSeenAt).toBeTruthy();
  });

  it("refuses a second machine on a 1-device key, unknown keys, and revoked keys", async () => {
    expect(await validateLicense(key, { machineId: "machine-2" })).toEqual({ valid: false, reason: "device_limit" });
    expect(await validateLicense("BB-ZZZZ-ZZZZ-ZZZZ-ZZZZ", { machineId: "machine-2" })).toEqual({ valid: false, reason: "not_found" });
    await setLicenseStatus(ws, licenseId, "revoked");
    expect(await validateLicense(key, { machineId: "machine-1" })).toEqual({ valid: false, reason: "revoked" });
    await setLicenseStatus(ws, licenseId, "active");
    expect((await validateLicense(key, { machineId: "machine-1" })).valid).toBe(true);
  });

  it("marks an overdue key expired on validation; extend reactivates it", async () => {
    await systemDb().update(schema.botLicenses).set({ expiresAt: new Date(Date.now() - DAY) }).where(eq(schema.botLicenses.id, licenseId));
    expect(await validateLicense(key, { machineId: "machine-1" })).toEqual({ valid: false, reason: "expired" });
    expect((await systemDb().select().from(schema.botLicenses).where(eq(schema.botLicenses.id, licenseId)))[0].status).toBe("expired");
    const until = await extendLicense(ws, licenseId, 30);
    expect(until.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect((await validateLicense(key, { machineId: "machine-1" })).valid).toBe(true);
  });

  it("ingests trades with ref dedupe and upserts status", async () => {
    const v = await validateLicense(key, { machineId: "machine-1" });
    if (!v.valid) throw new Error("expected valid");
    const base = Math.floor(Date.now() / 1000) - 3600;
    const trades = [
      { traded_at: base, symbol: "frxEURUSD", direction: "CALL" as const, stake: 10, confidence: 0.8, outcome: "win" as const, pnl: 8.5, ref: "c1", strategy: "mean_reversion", broker: "deriv", reasons: ["rsi oversold"] },
      { traded_at: base + 60, symbol: "frxEURUSD", direction: "PUT" as const, stake: 10, confidence: 0.6, outcome: "loss" as const, pnl: -10, ref: "c2" },
      { traded_at: base + 120, symbol: "R_100", direction: "CALL" as const, stake: 10, outcome: "win" as const, pnl: 9, ref: null },
    ];
    expect(await ingestTrades(v.licenseId, v.deviceId, trades)).toBe(3);
    expect(await ingestTrades(v.licenseId, v.deviceId, trades.slice(0, 2))).toBe(0); // re-sent, same refs
    expect(await ingestTrades(v.licenseId, v.deviceId, [trades[2]])).toBe(1); // no ref → cannot dedupe
    await ingestStatus(v.deviceId, { balance: 1007.5, summary: { wins: 2, losses: 1, pnl: 7.5, halted: null }, config: { symbols: ["frxEURUSD", "R_100"], expiry_sec: 60 }, version: "0.2.0" });
    await ingestStatus(v.deviceId, { balance: 1010, summary: { wins: 3, losses: 1, pnl: 10 } });
    const d = await getLicenseDetail(ws, licenseId);
    expect(d?.devices[0].status?.balance).toBe(1010);
    expect(d?.devices[0].status?.summary.wins).toBe(3);
    expect(d?.devices[0].device.version).toBe("0.2.0");
    expect(d?.trades.length).toBe(4);
    expect(d?.stats).toMatchObject({ trades: 4, wins: 3, losses: 1, winRate: 75, pnl: 16.5 });
  });

  it("builds the overview with equity, hour and symbol breakdowns", async () => {
    const o = await getBotOverview(ws, parseBotFilter({ range: "7" }));
    expect(o.activeLicenses).toBe(1);
    expect(o.devicesOnline).toBe(1);
    expect(o.trades).toBe(4);
    expect(o.winRate).toBe(75);
    expect(o.pnl).toBe(16.5);
    expect(o.equity.at(-1)?.value).toBe(16.5);
    expect(o.byHour).toHaveLength(24);
    expect(o.byHour.reduce((s, h) => s + h.trades, 0)).toBe(4);
    expect(o.bySymbol.map((s) => s.symbol).sort()).toEqual(["R_100", "frxEURUSD"]);
    expect(o.recent).toHaveLength(4);
    const onlyWins = await getBotOverview(ws, parseBotFilter({ range: "7", outcome: "win", symbol: "frxEURUSD" }));
    expect(onlyWins.recent).toHaveLength(1);
    expect(onlyWins.recent[0].licenseLabel).toBe("Customer A");
    const list = await listLicenses(ws);
    expect(list[0]).toMatchObject({ deviceCount: 1, onlineCount: 1, tradeCount: 4 });
  });

  it("keeps another workspace from seeing these trades or licenses", async () => {
    const other = (await makeUser("Other")).workspace.id;
    const o = await getBotOverview(other, parseBotFilter({ range: "90" }));
    expect(o.trades).toBe(0);
    expect(o.totalLicenses).toBe(0);
    expect(await listLicenses(other)).toEqual([]);
    expect(await getLicenseDetail(other, licenseId)).toBeNull();
    const rows = await withTenant(other, (tx) => tx.select().from(schema.botTrades));
    expect(rows).toEqual([]);
    await expect(setLicenseStatus(other, licenseId, "revoked")).rejects.toThrow(/not found/);
  });
});

describe("public bot API routes", () => {
  let key: string;
  beforeAll(async () => {
    const ws = (await makeUser("Route Admin")).workspace.id;
    key = (await createLicense(ws, { label: "Route customer", plan: "lifetime", maxDevices: 2, expiresAt: null, features: { auto_trade: false } })).key;
  });

  const json = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("validate: 400 on bad body, valid:false on unknown key, valid:true with snake_case fields", async () => {
    expect((await validatePost(json("/api/bot/license/validate", { key }))).status).toBe(400);
    const nf = await (await validatePost(json("/api/bot/license/validate", { key: "BB-AAAA-AAAA-AAAA-AAAA", machine_id: "box-1" }))).json();
    expect(nf).toEqual({ valid: false, reason: "not_found" });
    const res = await validatePost(json("/api/bot/license/validate", { key, machine_id: "box-1", version: "0.1.0", hostname: "box", broker: "paper" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ valid: true, plan: "lifetime", expires_at: null, features: { auto_trade: false }, label: "Route customer" });
    expect(body.license_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.device_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ingest: requires headers, validates the body, dedupes and records status", async () => {
    expect((await ingestPost(json("/api/bot/ingest", { type: "status", status: {} }))).status).toBe(401);
    const h = { "x-license-key": key, "x-machine-id": "box-1" };
    expect((await ingestPost(json("/api/bot/ingest", { type: "trade", trade: { symbol: "x" } }, h))).status).toBe(400);
    expect((await ingestPost(json("/api/bot/ingest", { type: "status", status: { balance: 50 } }, { ...h, "x-license-key": "BB-AAAA-AAAA-AAAA-AAAA" }))).status).toBe(401);
    const t = { traded_at: Math.floor(Date.now() / 1000), symbol: "frxGBPUSD", direction: "PUT", stake: 5, confidence: 0.7, outcome: "loss", pnl: -5, ref: "r-1", reasons: ["touched upper band"] };
    expect(await (await ingestPost(json("/api/bot/ingest", { type: "trade", trade: t }, h))).json()).toEqual({ ok: true, inserted: 1, received: 1 });
    expect(await (await ingestPost(json("/api/bot/ingest", { type: "trades", trades: [t, { ...t, ref: "r-2" }] }, h))).json()).toEqual({ ok: true, inserted: 1, received: 2 });
    const s = await ingestPost(json("/api/bot/ingest", { type: "status", status: { balance: 95, summary: { wins: 0, losses: 2, pnl: -10, halted: "2 consecutive losses" }, config: { symbols: ["frxGBPUSD"] }, broker: "paper" } }, h));
    expect(await s.json()).toEqual({ ok: true });
    // A third machine is over the limit and gets 401 on ingest too.
    expect((await ingestPost(json("/api/bot/ingest", { type: "status", status: {} }, { ...h, "x-machine-id": "box-2" }))).status).toBe(200);
    expect((await ingestPost(json("/api/bot/ingest", { type: "status", status: {} }, { ...h, "x-machine-id": "box-3" }))).status).toBe(401);
  });
});
