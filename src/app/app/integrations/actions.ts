"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { getProvider } from "@/lib/providers/registry";
import { saveIntegration, testIntegration } from "@/lib/services/integrations";
import { audit } from "@/lib/services/audit";

const schema = z.object({ providerId: z.string().min(1).max(64), enabled: z.string().optional() }).catchall(z.union([z.string(), z.array(z.string())]));

export const saveIntegrationAction = action({ schema, role: "admin" }, async (ctx, input) => {
  const def = getProvider(input.providerId);
  if (!def) return { error: "Unknown data source" };
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  const settings: Record<string, string> = {};
  for (const f of def.settingFields) {
    const v = str(`setting_${f.key}`);
    if (f.type === "checkbox") settings[f.key] = v === "on" || v === "1" ? "1" : "0";
    else if (v !== undefined) settings[f.key] = v;
  }
  const secrets: Record<string, string> = {};
  for (const f of def.secretFields) {
    const v = str(`secret_${f.key}`);
    if (v) secrets[f.key] = v;
    if (str(`secret_${f.key}__clear`) === "on") secrets[`${f.key}__clear`] = "1";
  }
  await saveIntegration(ctx.workspace.id, def.id, { enabled: input.enabled === "on", settings, secrets });
  // Audit without secret values.
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.update", targetType: "integration", targetId: def.id, metadata: { enabled: input.enabled === "on", settingsChanged: Object.keys(settings), secretsChanged: Object.keys(secrets) } });
  revalidatePath("/app/integrations");
  return { message: `${def.name} saved. Run a connection test to verify it.` };
});

export const testIntegrationAction = action({ schema: z.object({ providerId: z.string().min(1).max(64) }), role: "admin" }, async (ctx, input) => {
  const def = getProvider(input.providerId);
  if (!def?.test) return { error: "This source has no connection test." };
  const res = await testIntegration(ctx.workspace.id, def.id);
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.test", targetType: "integration", targetId: def.id, metadata: { ok: res.ok } });
  revalidatePath("/app/integrations");
  return res.ok ? { message: `Connected: ${res.message}` } : { error: `Connection test failed: ${res.message}` };
});
