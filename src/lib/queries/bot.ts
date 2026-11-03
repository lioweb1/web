import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { parseRange, type Range } from "./analytics";

export type BotFilter = Range & { preset: string; license: string | null; symbol: string | null; outcome: string | null };

const UUID = /^[0-9a-f-]{36}$/i;
const OUTCOMES = ["win", "loss", "tie", "unknown"];

/** ?range=…&license=<uuid>&symbol=EURUSD&outcome=win on top of the analytics date range. */
export function parseBotFilter(sp: Record<string, string | string[] | undefined>): BotFilter {
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const r = parseRange(sp);
  const license = UUID.test(get("license")) ? get("license") : null;
  const symbol = get("symbol").trim().slice(0, 40) || null;
  const outcome = OUTCOMES.includes(get("outcome")) ? get("outcome") : null;
  return { ...r, license, symbol, outcome };
}

export function botFilterQuery(f: BotFilter, overrides: Partial<Record<"range" | "from" | "to" | "license" | "symbol" | "outcome", string | null>> = {}): string {
  const p = new URLSearchParams();
  const v = { range: f.preset, from: f.preset === "custom" ? f.from.toISOString().slice(0, 10) : null, to: f.preset === "custom" ? f.to.toISOString().slice(0, 10) : null, license: f.license, symbol: f.symbol, outcome: f.outcome, ...overrides };
  for (const [k, val] of Object.entries(v)) if (val) p.set(k, val);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function tradeWhere(f: BotFilter): SQL {
  const T = schema.botTrades;
  const parts: SQL[] = [gte(T.tradedAt, f.from), lte(T.tradedAt, f.to)];
  if (f.license) parts.push(eq(T.licenseId, f.license));
  if (f.symbol) parts.push(eq(T.symbol, f.symbol));
  if (f.outcome) parts.push(eq(T.outcome, f.outcome));
  return and(...parts)!;
}

const num = (v: unknown) => Number(v ?? 0);

export type BotOverview = {
  activeLicenses: number;
  totalLicenses: number;
  devicesOnline: number;
  devicesTotal: number;
  tradesToday: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnl: number;
  equity: { t: string; value: number }[];
  byHour: { hour: string; trades: number; wins: number; losses: number; winRate: number | null; pnl: number }[];
  bySymbol: { symbol: string; trades: number; wins: number; losses: number; winRate: number | null; pnl: number }[];
  recent: RecentTrade[];
  symbols: string[];
  licenses: { id: string; label: string }[];
};

export type RecentTrade = {
  id: string;
  tradedAt: Date;
  symbol: string;
  direction: string;
  stake: number;
  confidence: number | null;
  outcome: string;
  pnl: number;
  strategy: string | null;
  broker: string | null;
  licenseId: string;
  licenseLabel: string;
  hostname: string | null;
};

function rate(wins: number, losses: number): number | null {
  const n = wins + losses;
  return n ? Math.round((1000 * wins) / n) / 10 : null;
}

export async function getBotOverview(ws: string, f: BotFilter, now = new Date()): Promise<BotOverview> {
  const L = schema.botLicenses;
  const D = schema.botDevices;
  const T = schema.botTrades;
  const where = tradeWhere(f);
  const onlineSince = new Date(now.getTime() - 5 * 60_000);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  return withTenant(ws, async (tx) => {
    const [licenses, [devAgg], [todayAgg], [agg], hourRows, symbolRows, equityRows, recent, symbolList] = await Promise.all([
      tx.select({ id: L.id, label: L.label, status: L.status, expiresAt: L.expiresAt }).from(L).where(eq(L.workspaceId, ws)).orderBy(L.label),
      tx.select({ total: sql<number>`count(*)::int`, online: sql<number>`count(*) filter (where ${D.lastSeenAt} >= ${onlineSince})::int` }).from(D),
      tx.select({ n: sql<number>`count(*)::int` }).from(T).where(and(gte(T.tradedAt, todayStart), f.license ? eq(T.licenseId, f.license) : undefined)),
      tx
        .select({ n: sql<number>`count(*)::int`, wins: sql<number>`count(*) filter (where ${T.outcome} = 'win')::int`, losses: sql<number>`count(*) filter (where ${T.outcome} = 'loss')::int`, pnl: sql<number>`coalesce(sum(${T.pnl}), 0)` })
        .from(T)
        .where(where),
      tx
        .select({ hour: sql<number>`extract(hour from ${T.tradedAt} at time zone 'UTC')::int`, n: sql<number>`count(*)::int`, wins: sql<number>`count(*) filter (where ${T.outcome} = 'win')::int`, losses: sql<number>`count(*) filter (where ${T.outcome} = 'loss')::int`, pnl: sql<number>`coalesce(sum(${T.pnl}), 0)` })
        .from(T)
        .where(where)
        .groupBy(sql`1`),
      tx
        .select({ symbol: T.symbol, n: sql<number>`count(*)::int`, wins: sql<number>`count(*) filter (where ${T.outcome} = 'win')::int`, losses: sql<number>`count(*) filter (where ${T.outcome} = 'loss')::int`, pnl: sql<number>`coalesce(sum(${T.pnl}), 0)` })
        .from(T)
        .where(where)
        .groupBy(T.symbol)
        .orderBy(sql`count(*) desc`)
        .limit(30),
      tx.select({ t: T.tradedAt, pnl: T.pnl }).from(T).where(where).orderBy(T.tradedAt, T.createdAt).limit(5000),
      tx
        .select({ id: T.id, tradedAt: T.tradedAt, symbol: T.symbol, direction: T.direction, stake: T.stake, confidence: T.confidence, outcome: T.outcome, pnl: T.pnl, strategy: T.strategy, broker: T.broker, licenseId: T.licenseId, licenseLabel: L.label, hostname: D.hostname })
        .from(T)
        .innerJoin(L, eq(L.id, T.licenseId))
        .leftJoin(D, eq(D.id, T.deviceId))
        .where(where)
        .orderBy(desc(T.tradedAt))
        .limit(50),
      tx.selectDistinct({ symbol: T.symbol }).from(T).orderBy(T.symbol).limit(100),
    ]);

    let running = 0;
    const equityAll = equityRows.map((r) => ({ t: r.t.toISOString(), value: (running = Math.round((running + num(r.pnl)) * 100) / 100) }));
    const step = Math.max(1, Math.ceil(equityAll.length / 400));
    const equity = equityAll.filter((_, i) => i % step === 0 || i === equityAll.length - 1);

    const hourMap = new Map(hourRows.map((h) => [num(h.hour), h]));
    const byHour = Array.from({ length: 24 }, (_, h) => {
      const r = hourMap.get(h);
      const wins = num(r?.wins), losses = num(r?.losses);
      return { hour: `${String(h).padStart(2, "0")}h`, trades: num(r?.n), wins, losses, winRate: rate(wins, losses), pnl: Math.round(num(r?.pnl) * 100) / 100 };
    });

    const activeLicenses = licenses.filter((l) => l.status === "active" && (!l.expiresAt || l.expiresAt.getTime() > now.getTime())).length;
    return {
      activeLicenses,
      totalLicenses: licenses.length,
      devicesOnline: num(devAgg?.online),
      devicesTotal: num(devAgg?.total),
      tradesToday: num(todayAgg?.n),
      trades: num(agg?.n),
      wins: num(agg?.wins),
      losses: num(agg?.losses),
      winRate: rate(num(agg?.wins), num(agg?.losses)),
      pnl: Math.round(num(agg?.pnl) * 100) / 100,
      equity,
      byHour,
      bySymbol: symbolRows.map((r) => ({ symbol: r.symbol, trades: num(r.n), wins: num(r.wins), losses: num(r.losses), winRate: rate(num(r.wins), num(r.losses)), pnl: Math.round(num(r.pnl) * 100) / 100 })),
      recent: recent.map((r) => ({ ...r, confidence: r.confidence ?? null })),
      symbols: symbolList.map((s) => s.symbol),
      licenses: licenses.map((l) => ({ id: l.id, label: l.label })),
    };
  });
}

export type LicenseRow = typeof schema.botLicenses.$inferSelect & { deviceCount: number; onlineCount: number; tradeCount: number };

export async function listLicenses(ws: string, now = new Date()): Promise<LicenseRow[]> {
  const L = schema.botLicenses;
  const D = schema.botDevices;
  const T = schema.botTrades;
  const onlineSince = new Date(now.getTime() - 5 * 60_000);
  return withTenant(ws, async (tx) => {
    const rows = await tx.select().from(L).where(eq(L.workspaceId, ws)).orderBy(desc(L.createdAt));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [devs, trades] = await Promise.all([
      tx.select({ licenseId: D.licenseId, n: sql<number>`count(*)::int`, online: sql<number>`count(*) filter (where ${D.lastSeenAt} >= ${onlineSince})::int` }).from(D).where(inArray(D.licenseId, ids)).groupBy(D.licenseId),
      tx.select({ licenseId: T.licenseId, n: sql<number>`count(*)::int` }).from(T).where(inArray(T.licenseId, ids)).groupBy(T.licenseId),
    ]);
    const dm = new Map(devs.map((d) => [d.licenseId, d]));
    const tm = new Map(trades.map((t) => [t.licenseId, num(t.n)]));
    return rows.map((r) => ({ ...r, deviceCount: num(dm.get(r.id)?.n), onlineCount: num(dm.get(r.id)?.online), tradeCount: tm.get(r.id) ?? 0 }));
  });
}

export async function getLicenseDetail(ws: string, licenseId: string) {
  const L = schema.botLicenses;
  const D = schema.botDevices;
  const S = schema.botStatus;
  const T = schema.botTrades;
  return withTenant(ws, async (tx) => {
    const [license] = await tx.select().from(L).where(eq(L.id, licenseId));
    if (!license) return null;
    const [devices, trades] = await Promise.all([
      tx
        .select({ device: D, status: S })
        .from(D)
        .leftJoin(S, eq(S.deviceId, D.id))
        .where(eq(D.licenseId, licenseId))
        .orderBy(desc(D.lastSeenAt)),
      tx.select().from(T).where(eq(T.licenseId, licenseId)).orderBy(desc(T.tradedAt)).limit(100),
    ]);
    const [agg] = await tx
      .select({ n: sql<number>`count(*)::int`, wins: sql<number>`count(*) filter (where ${T.outcome} = 'win')::int`, losses: sql<number>`count(*) filter (where ${T.outcome} = 'loss')::int`, pnl: sql<number>`coalesce(sum(${T.pnl}), 0)` })
      .from(T)
      .where(eq(T.licenseId, licenseId));
    return { license, devices, trades, stats: { trades: num(agg?.n), wins: num(agg?.wins), losses: num(agg?.losses), winRate: rate(num(agg?.wins), num(agg?.losses)), pnl: Math.round(num(agg?.pnl) * 100) / 100 } };
  });
}
