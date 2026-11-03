import { NextResponse } from "next/server";
import { z } from "zod";
import { validateLicense } from "@/lib/services/bot";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  key: z.string().min(8).max(64),
  machine_id: z.string().min(4).max(120),
  version: z.string().max(40).optional(),
  hostname: z.string().max(120).optional(),
  broker: z.string().max(40).optional(),
});

/**
 * Called by the bot on start-up and periodically. Authenticated by the license key alone;
 * registers the device (respecting max_devices) and returns the plan and features.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  try {
    await rateLimit(`bot-validate:${ip}`, 60, 60);
  } catch {
    return NextResponse.json({ valid: false, reason: "rate_limited" }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ valid: false, reason: "bad_request", error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const b = parsed.data;
  const res = await validateLicense(b.key, { machineId: b.machine_id, version: b.version, hostname: b.hostname, broker: b.broker });
  if (!res.valid) return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { valid: true, license_id: res.licenseId, device_id: res.deviceId, plan: res.plan, label: res.label, expires_at: res.expiresAt ? res.expiresAt.toISOString() : null, features: res.features },
    { headers: { "Cache-Control": "no-store" } },
  );
}
