"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, simpleAction, zArr, zBool, zUuid } from "@/lib/action";
import { enqueue } from "@/lib/jobs/queue";
import { audit } from "@/lib/services/audit";
import { getConnectionDef, saveConnection } from "@/lib/social/accounts";
import { deletePost, generateFromText, queuePublish, saveAutopilot, setPostStatus, testConnection, updatePost } from "@/lib/social/service";

const lines = z.preprocess((v) => (typeof v === "string" ? v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : []), z.array(z.string().max(300)));
const optUrl = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().url().max(2000).nullable());

const settingsSchema = z.object({
  active: zBool,
  intervalMinutes: z.coerce.number().int().min(30).max(10080),
  keywords: lines,
  sources: zArr,
  subreddits: lines,
  feeds: lines,
  platforms: zArr,
  aiProvider: z.string().min(1).max(40),
  brandName: z.string().trim().max(120).default(""),
  brandVoice: z.string().trim().max(2000).default(""),
  link: z.string().trim().max(2000).default(""),
  language: z.string().trim().min(1).max(40).default("English"),
  mode: z.enum(["approve", "auto"]),
  maxPostsPerDay: z.coerce.number().int().min(1).max(20),
  draftsPerScan: z.coerce.number().int().min(1).max(10),
});

export const saveAutopilotAction = action({ schema: settingsSchema, role: "admin" }, async (ctx, i) => {
  const { active, intervalMinutes, ...config } = i;
  await saveAutopilot(ctx.workspace.id, { active, intervalMinutes, config: { ...config, keywords: config.keywords.slice(0, 20) } });
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "social.autopilot.update", metadata: { active, mode: config.mode, platforms: config.platforms, sources: config.sources } });
  revalidatePath("/app/social");
  return { message: active ? `Autopilot is on. ${config.mode === "auto" ? "Posts will publish automatically" : "Drafts will wait for your approval"}.` : "Settings saved. Autopilot is off." };
});

const connSchema = z.object({ kind: z.enum(["ai", "platform"]), id: z.string().min(1).max(40), enabled: z.string().optional() }).catchall(z.union([z.string(), z.array(z.string())]));

export const saveConnectionAction = action({ schema: connSchema, role: "admin" }, async (ctx, input) => {
  const def = getConnectionDef(input.kind, input.id);
  if (!def) return { error: "Unknown connection" };
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  const settings: Record<string, string> = {};
  for (const f of def.settingFields) settings[f.key] = str(`setting_${f.key}`) ?? "";
  const secrets: Record<string, string> = {};
  const clear: string[] = [];
  for (const f of def.secretFields) {
    const v = str(`secret_${f.key}`);
    if (v) secrets[f.key] = v;
    if (str(`secret_${f.key}__clear`) === "on") clear.push(f.key);
  }
  // AI writers have no on/off switch: the one selected in settings is used.
  await saveConnection(ctx.workspace.id, def, { enabled: def.kind === "ai" || input.enabled === "on", settings, secrets, clear });
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "social.connection.update", targetType: "integration", targetId: `${def.kind}:${def.id}`, metadata: { settingsChanged: Object.keys(settings), secretsChanged: Object.keys(secrets) } });
  revalidatePath("/app/social");
  return { message: `${def.name} saved. Run a connection test to verify it.` };
});

export const testConnectionAction = action({ schema: z.object({ kind: z.enum(["ai", "platform"]), id: z.string().min(1).max(40) }), role: "admin" }, async (ctx, input) => {
  const def = getConnectionDef(input.kind, input.id);
  if (!def) return { error: "Unknown connection" };
  const res = await testConnection(ctx.workspace.id, def);
  revalidatePath("/app/social");
  return res.ok ? { message: `Connected: ${res.message}` } : { error: `Connection test failed: ${res.message}` };
});

export const runScanNowAction = simpleAction({ schema: z.object({}), role: "member" }, async (ctx) => {
  await enqueue({ type: "social_scan", workspaceId: ctx.workspace.id, idempotencyKey: `social_scan:manual:${ctx.workspace.id}:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 1 });
  revalidatePath("/app/social");
});

export const generateAction = action(
  { schema: z.object({ text: z.string().trim().min(3, "Paste some text first").max(5000), url: optUrl, imageUrl: optUrl, platforms: zArr }), role: "member" },
  async (ctx, i) => {
    await generateFromText(ctx.workspace.id, { text: i.text, url: i.url, imageUrl: i.imageUrl, platforms: i.platforms });
    revalidatePath("/app/social");
    return { message: "Draft created. Review it below." };
  },
);

export const updatePostAction = action(
  {
    schema: z.object({
      postId: zUuid,
      hook: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(5000),
      shortBody: z.string().trim().min(1).max(600),
      engagementComment: z.string().trim().max(1000).default(""),
      hashtags: lines,
      imageUrl: optUrl,
      platforms: zArr,
    }),
    role: "member",
  },
  async (ctx, i) => {
    const { postId, ...patch } = i;
    await updatePost(ctx.workspace.id, postId, { ...patch, hashtags: patch.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10) });
    revalidatePath("/app/social");
    return { message: "Saved" };
  },
);

export const publishPostAction = simpleAction({ schema: z.object({ postId: zUuid }), role: "member", audit: "social.post.publish" }, async (ctx, i) => {
  await queuePublish(ctx.workspace.id, i.postId);
  revalidatePath("/app/social");
});

export const rejectPostAction = simpleAction({ schema: z.object({ postId: zUuid, restore: z.string().optional() }), role: "member" }, async (ctx, i) => {
  await setPostStatus(ctx.workspace.id, i.postId, i.restore ? "draft" : "rejected");
  revalidatePath("/app/social");
});

export const deletePostAction = simpleAction({ schema: z.object({ postId: zUuid }), role: "member" }, async (ctx, i) => {
  await deletePost(ctx.workspace.id, i.postId);
  revalidatePath("/app/social");
});
