"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, simpleAction, zArr, zBool, zInt, zOptDate, zUuid } from "@/lib/action";
import { BOT_BROKERS, BOT_PLANS, createLicense, deleteDevice, deleteLicense, extendLicense, planDuration, setLicenseStatus, updateLicenseNotes } from "@/lib/services/bot";

const createSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(120),
  plan: z.enum(BOT_PLANS),
  maxDevices: zInt(1, 50),
  expiry: z.enum(["plan", "custom", "never"]).default("plan"),
  expiresAt: zOptDate,
  autoTrade: zBool,
  copier: zBool,
  extension: zBool,
  maxSymbols: zInt(1, 50),
  brokers: zArr,
  notes: z.string().trim().max(2000).optional(),
});

export const createLicenseAction = action({ schema: createSchema, role: "admin", audit: "bot.license.create" }, async (ctx, i) => {
  const expiresAt = i.expiry === "never" ? null : i.expiry === "custom" ? i.expiresAt : planDuration(i.plan);
  if (i.expiry === "custom" && !expiresAt) return { error: "Pick an expiry date or choose another expiry option." };
  const brokers = i.brokers.filter((b): b is (typeof BOT_BROKERS)[number] => (BOT_BROKERS as readonly string[]).includes(b));
  const lic = await createLicense(ctx.workspace.id, {
    label: i.label,
    plan: i.plan,
    maxDevices: i.maxDevices,
    expiresAt,
    features: { auto_trade: i.autoTrade, copier: i.copier, extension: i.extension, max_symbols: i.maxSymbols, brokers },
    notes: i.notes || null,
  });
  revalidatePath("/app/bot/licenses");
  return { message: `License “${lic.label}” created. Give this key to the customer; it stays visible in the list.`, data: { secret: lic.key } };
});

const idSchema = z.object({ licenseId: zUuid });

export const revokeLicenseAction = simpleAction({ schema: idSchema, role: "admin", audit: "bot.license.revoke" }, async (ctx, i) => {
  await setLicenseStatus(ctx.workspace.id, i.licenseId, "revoked");
  revalidatePath("/app/bot/licenses");
  revalidatePath(`/app/bot/licenses/${i.licenseId}`);
});

export const reactivateLicenseAction = simpleAction({ schema: idSchema, role: "admin", audit: "bot.license.reactivate" }, async (ctx, i) => {
  await setLicenseStatus(ctx.workspace.id, i.licenseId, "active");
  revalidatePath("/app/bot/licenses");
  revalidatePath(`/app/bot/licenses/${i.licenseId}`);
});

export const extendLicenseAction = simpleAction({ schema: z.object({ licenseId: zUuid, days: zInt(1, 3650).default(30) }), role: "admin", audit: "bot.license.extend" }, async (ctx, i) => {
  await extendLicense(ctx.workspace.id, i.licenseId, i.days);
  revalidatePath("/app/bot/licenses");
  revalidatePath(`/app/bot/licenses/${i.licenseId}`);
});

export const deleteLicenseAction = simpleAction({ schema: idSchema, role: "owner", audit: "bot.license.delete" }, async (ctx, i) => {
  await deleteLicense(ctx.workspace.id, i.licenseId);
  revalidatePath("/app/bot/licenses");
});

export const deleteDeviceAction = simpleAction({ schema: z.object({ licenseId: zUuid, deviceId: zUuid }), role: "admin", audit: "bot.device.delete" }, async (ctx, i) => {
  await deleteDevice(ctx.workspace.id, i.licenseId, i.deviceId);
  revalidatePath(`/app/bot/licenses/${i.licenseId}`);
  revalidatePath("/app/bot/licenses");
});

export const updateNotesAction = action({ schema: z.object({ licenseId: zUuid, notes: z.string().trim().max(2000) }), role: "admin" }, async (ctx, i) => {
  await updateLicenseNotes(ctx.workspace.id, i.licenseId, i.notes || null);
  revalidatePath(`/app/bot/licenses/${i.licenseId}`);
  return { message: "Notes saved." };
});
