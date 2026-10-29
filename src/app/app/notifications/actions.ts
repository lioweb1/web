"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { action, simpleAction, zArr, zCsv, zInt } from "@/lib/action";
import { schema, withTenant } from "@/lib/db";
import { NOTIFICATION_TYPES } from "@/lib/notifications/notify";
import type { NotificationPrefsShape } from "@/lib/db/schema";

export const markReadAction = simpleAction({ schema: z.object({ ids: zArr, all: z.string().optional() }) }, async (ctx, input) => {
  const N = schema.notifications;
  const mine = and(eq(N.workspaceId, ctx.workspace.id), eq(N.userId, ctx.user.id), isNull(N.readAt));
  const ids = input.ids.filter((i) => /^[0-9a-f-]{36}$/.test(i));
  await withTenant(ctx.workspace.id, async (tx) => {
    if (input.all === "1") await tx.update(N).set({ readAt: new Date() }).where(mine);
    else if (ids.length) await tx.update(N).set({ readAt: new Date() }).where(and(mine, inArray(N.id, ids)));
  });
  revalidatePath("/app/notifications");
});

const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

const prefsSchema = z.object({
  types: zArr,
  minScore: zInt(0, 100),
  countries: zCsv,
  email: z.enum(["off", "immediate", "daily"]),
  browser: z.string().optional(),
  quietEnabled: z.string().optional(),
  quietStart: time,
  quietEnd: time,
  timezone: z.string().min(1).max(64),
});

export const savePrefsAction = action({ schema: prefsSchema }, async (ctx, input) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    return { error: `Unknown time zone "${input.timezone}". Use an IANA name like Europe/Berlin.` };
  }
  const prefs: NotificationPrefsShape = {
    types: Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((k) => [k, input.types.includes(k)])),
    minScore: input.minScore,
    countries: input.countries.map((c) => c.toUpperCase()),
    email: input.email,
    browser: input.browser === "on",
    quietHours: { enabled: input.quietEnabled === "on", start: input.quietStart, end: input.quietEnd, timezone: input.timezone },
  };
  await withTenant(ctx.workspace.id, (tx) =>
    tx
      .insert(schema.notificationPrefs)
      .values({ workspaceId: ctx.workspace.id, userId: ctx.user.id, prefs })
      .onConflictDoUpdate({ target: [schema.notificationPrefs.workspaceId, schema.notificationPrefs.userId], set: { prefs, updatedAt: new Date() } }),
  );
  revalidatePath("/app/notifications");
  return { message: "Notification preferences saved." };
});
