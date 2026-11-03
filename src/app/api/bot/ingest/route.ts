import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestStatus, ingestTrades, validateLicense } from "@/lib/services/bot";

export const dynamic = "force-dynamic";

const tradeSchema = z.object({
  traded_at: z.number().int().positive(),
  symbol: z.string().min(1).max(40),
  direction: z.enum(["CALL", "PUT"]),
  stake: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).nullish(),
  outcome: z.enum(["win", "loss", "tie", "unknown"]),
  pnl: z.number(),
  ref: z.string().max(120).nullish(),
  strategy: z.string().max(60).nullish(),
  broker: z.string().max(40).nullish(),
  reasons: z.array(z.string().max(200)).max(20).optional(),
});

const statusSchema = z.object({
  balance: z.number().nullish(),
  summary: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  version: z.string().max(40).nullish(),
  broker: z.string().max(40).nullish(),
});

export const ingestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trade"), trade: tradeSchema }),
  z.object({ type: z.literal("trades"), trades: z.array(tradeSchema).max(500) }),
  z.object({ type: z.literal("status"), status: statusSchema }),
]);

/** Bot → dashboard feed. Headers: x-license-key, x-machine-id. */
export async function POST(req: Request) {
  const key = req.headers.get("x-license-key");
  const machineId = req.headers.get("x-machine-id");
  if (!key || !machineId) return NextResponse.json({ error: "x-license-key and x-machine-id headers are required" }, { status: 401 });
  const parsed = ingestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });

  const lic = await validateLicense(key, { machineId });
  if (!lic.valid) return NextResponse.json({ error: `license ${lic.reason}` }, { status: 401 });

  const body = parsed.data;
  if (body.type === "status") {
    await ingestStatus(lic.deviceId, { balance: body.status.balance, summary: body.status.summary as never, config: body.status.config, version: body.status.version, broker: body.status.broker });
    return NextResponse.json({ ok: true });
  }
  const trades = body.type === "trade" ? [body.trade] : body.trades;
  const inserted = await ingestTrades(lic.licenseId, lic.deviceId, trades.map((t) => ({ ...t, reasons: t.reasons ?? [] })));
  return NextResponse.json({ ok: true, inserted, received: trades.length });
}
