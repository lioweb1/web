"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, simpleAction, zArr, zBool, zUuid } from "@/lib/action";
import { enqueue } from "@/lib/jobs/queue";
import { audit } from "@/lib/services/audit";
import { GOOGLE_ACCOUNT, getConnectionDef, removeConnectionSecrets, saveConnection } from "@/lib/social/accounts";
import { regenerateReply, sendReply, syncSeo, updateComment } from "@/lib/social/engage";
import { parseLocalDateTime } from "@/lib/social/schedule";
import { fmtSlot } from "@/lib/social/format";
import { createComposerPost, prepareVideo, deletePost, generateFromText, getAutopilot, publishNow, queuePublish, regeneratePost, saveAutopilot, setPostStatus, testConnection, unschedulePost, updatePost } from "@/lib/social/service";

const lines = z.preprocess((v) => (typeof v === "string" ? v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : []), z.array(z.string().max(300)));
const paragraphs = z.preprocess((v) => (typeof v === "string" ? v.split(/\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean) : []), z.array(z.string().max(500)));
const optUrl = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().url().max(2000).nullable());
const optText = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(3000).nullable());

const revalidate = () => revalidatePath("/app/social", "layout");

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
  scheduleMode: z.enum(["slots", "immediate"]),
  postingTimes: lines,
  timezone: z.string().trim().min(1).max(60),
  autoReply: z.enum(["off", "approve", "auto"]),
  maxRepliesPerDay: z.coerce.number().int().min(1).max(200),
  rotateHooks: zBool,
  threadMode: zBool,
  autoImage: zBool,
  brandColor: z.string().trim().max(7).default("#4f46e5"),
  utm: zBool,
  videoSecondsPerSlide: z.coerce.number().min(1.5).max(10).default(3),
});

export const saveAutopilotAction = action({ schema: settingsSchema, role: "admin" }, async (ctx, i) => {
  const { active, intervalMinutes, ...config } = i;
  await saveAutopilot(ctx.workspace.id, { active, intervalMinutes, config: { ...config, keywords: config.keywords.slice(0, 20) } });
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "social.autopilot.update", metadata: { active, mode: config.mode, platforms: config.platforms, sources: config.sources, autoReply: config.autoReply } });
  revalidate();
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
  for (const f of def.settingFields) if (f.type === "checkbox") settings[f.key] = str(`setting_${f.key}`) === "on" ? "1" : "0";
  // AI writers and the Google account have no on/off switch.
  await saveConnection(ctx.workspace.id, def, { enabled: def.kind === "ai" || def.id === "google" || input.enabled === "on", settings, secrets, clear });
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "social.connection.update", targetType: "integration", targetId: `${def.kind}:${def.id}`, metadata: { settingsChanged: Object.keys(settings), secretsChanged: Object.keys(secrets) } });
  revalidate();
  return { message: `${def.name} saved. Run a connection test to verify it.` };
});

export const testConnectionAction = action({ schema: z.object({ kind: z.enum(["ai", "platform"]), id: z.string().min(1).max(40) }), role: "admin" }, async (ctx, input) => {
  const def = getConnectionDef(input.kind, input.id);
  if (!def) return { error: "Unknown connection" };
  const res = await testConnection(ctx.workspace.id, def);
  revalidate();
  return res.ok ? { message: `Connected: ${res.message}` } : { error: `Connection test failed: ${res.message}` };
});

export const runScanNowAction = simpleAction({ schema: z.object({}), role: "member" }, async (ctx) => {
  await enqueue({ type: "social_scan", workspaceId: ctx.workspace.id, idempotencyKey: `social_scan:manual:${ctx.workspace.id}:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 1 });
  revalidate();
});

export const syncEngagementNowAction = simpleAction({ schema: z.object({}), role: "member" }, async (ctx) => {
  await enqueue({ type: "social_engage", workspaceId: ctx.workspace.id, idempotencyKey: `social_engage:manual:${ctx.workspace.id}:${Math.floor(Date.now() / 60_000)}`, maxAttempts: 1 });
  revalidate();
});

export const generateAction = action(
  { schema: z.object({ text: z.string().trim().min(3, "Paste some text first").max(5000), url: optUrl, imageUrl: optUrl, platforms: zArr }), role: "member" },
  async (ctx, i) => {
    await generateFromText(ctx.workspace.id, { text: i.text, url: i.url, imageUrl: i.imageUrl, platforms: i.platforms });
    revalidate();
    return { message: "Draft created. Review it below." };
  },
);

export const updatePostAction = action(
  {
    schema: z.object({
      postId: zUuid,
      hook: z.string().trim().min(1).max(300),
      hookVariants: lines,
      body: z.string().trim().min(1).max(5000),
      shortBody: z.string().trim().min(1).max(600),
      linkedin: optText,
      instagram: optText,
      article: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(12000)),
      metaDescription: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(300)),
      thread: paragraphs,
      engagementComment: z.string().trim().max(1000).default(""),
      hashtags: lines,
      primaryKeyword: optText,
      altText: optText,
      imageUrl: optUrl,
      autoImage: zBool,
      platforms: zArr,
    }),
    role: "member",
  },
  async (ctx, i) => {
    const { postId, linkedin, instagram, article, metaDescription, hookVariants, ...patch } = i;
    // Empty strings clear a text; updatePost drops empty values.
    const platformTexts: Record<string, string> = { article, metaDescription };
    if (linkedin) platformTexts.linkedin = linkedin;
    if (instagram) platformTexts.instagram = instagram;
    await updatePost(ctx.workspace.id, postId, {
      ...patch,
      hookVariants: hookVariants.length ? hookVariants.slice(0, 5) : undefined,
      platformTexts,
      hashtags: patch.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10),
    });
    revalidate();
    return { message: "Saved" };
  },
);

export const chooseHookAction = simpleAction({ schema: z.object({ postId: zUuid, hook: z.string().trim().min(1).max(300) }), role: "member" }, async (ctx, i) => {
  await updatePost(ctx.workspace.id, i.postId, { hook: i.hook });
  revalidate();
});

export const schedulePostAction = simpleAction({ schema: z.object({ postId: zUuid, when: z.enum(["now", "slot"]) }), role: "member", audit: "social.post.schedule" }, async (ctx, i) => {
  await queuePublish(ctx.workspace.id, i.postId, { when: i.when });
  revalidate();
});

export const reschedulePostAction = action({ schema: z.object({ postId: zUuid, at: z.string().min(10).max(20) }), role: "member" }, async (ctx, i) => {
  const { config } = await getAutopilot(ctx.workspace.id);
  const at = parseLocalDateTime(i.at, config.timezone);
  if (!at) return { error: "Pick a date and time" };
  await queuePublish(ctx.workspace.id, i.postId, { when: at });
  revalidate();
  return { message: `Scheduled for ${fmtSlot(at, config.timezone)}` };
});

export const unschedulePostAction = simpleAction({ schema: z.object({ postId: zUuid }), role: "member" }, async (ctx, i) => {
  await unschedulePost(ctx.workspace.id, i.postId);
  revalidate();
});

export const regeneratePostAction = simpleAction({ schema: z.object({ postId: zUuid }), role: "member" }, async (ctx, i) => {
  await regeneratePost(ctx.workspace.id, i.postId);
  revalidate();
});

export const rejectPostAction = simpleAction({ schema: z.object({ postId: zUuid, restore: z.string().optional() }), role: "member" }, async (ctx, i) => {
  await setPostStatus(ctx.workspace.id, i.postId, i.restore ? "draft" : "rejected");
  revalidate();
});

export const deletePostAction = simpleAction({ schema: z.object({ postId: zUuid }), role: "member" }, async (ctx, i) => {
  await deletePost(ctx.workspace.id, i.postId);
  revalidate();
});

export const sendReplyAction = action({ schema: z.object({ commentId: zUuid, replyText: z.string().trim().min(1, "Write a reply").max(1000) }), role: "member" }, async (ctx, i) => {
  await sendReply(ctx.workspace.id, i.commentId, i.replyText);
  revalidate();
  return { message: "Reply sent" };
});

export const regenerateReplyAction = simpleAction({ schema: z.object({ commentId: zUuid }), role: "member" }, async (ctx, i) => {
  await regenerateReply(ctx.workspace.id, i.commentId);
  revalidate();
});

export const ignoreCommentAction = simpleAction({ schema: z.object({ commentId: zUuid, restore: z.string().optional() }), role: "member" }, async (ctx, i) => {
  await updateComment(ctx.workspace.id, i.commentId, { status: i.restore ? "new" : "ignored" });
  revalidate();
});

export const composeAction = action(
  {
    schema: z.object({
      title: z.string().trim().min(1, "Add a title").max(300),
      description: z.string().trim().max(2000).default(""),
      content: z.string().trim().max(10000).default(""),
      link: optUrl,
      hashtags: lines,
      mediaIds: zArr.pipe(z.array(zUuid).max(10, "Up to 10 images")),
      alts: zArr,
      platforms: zArr,
      when: z.enum(["now", "slot"]).default("now"),
    }),
    role: "member",
  },
  async (ctx, i) => {
    const ws = ctx.workspace.id;
    const post = await createComposerPost(ws, { title: i.title, description: i.description, content: i.content, link: i.link, hashtags: i.hashtags, mediaIds: i.mediaIds, alts: i.alts, platforms: i.platforms });
    await audit({ workspaceId: ws, userId: ctx.user.id, action: "social.compose", targetType: "social_post", targetId: post.id, metadata: { platforms: i.platforms, images: i.mediaIds.length, when: i.when } });
    revalidate();
    if (i.when === "slot") {
      const { config } = await getAutopilot(ws);
      const at = await queuePublish(ws, post.id, { when: "slot" });
      return { message: `Scheduled for ${fmtSlot(at, config.timezone)}.`, data: { postId: post.id, results: {} } };
    }
    const { post: done, retrying } = await publishNow(ws, post.id);
    const ok = done.platforms.filter((p) => done.results[p]?.ok);
    const failed = done.platforms.filter((p) => !done.results[p]?.ok);
    const data = { postId: done.id, results: Object.fromEntries(done.platforms.map((p) => [p, { ok: !!done.results[p]?.ok, url: done.results[p]?.url ?? null, error: done.results[p]?.error ?? null }])) };
    if (!failed.length) return { message: `Published on ${ok.length} platform${ok.length > 1 ? "s" : ""}.`, data };
    return { error: `${ok.length ? `Published on ${ok.length}, ` : ""}failed on ${failed.length}${retrying ? " — retrying automatically in a minute" : ""}.`, data };
  },
);

export const makeVideoAction = simpleAction({ schema: z.object({ postId: zUuid }), role: "member" }, async (ctx, i) => {
  await prepareVideo(ctx.workspace.id, i.postId);
  revalidate();
});

export const disconnectGoogleAction = simpleAction({ schema: z.object({}), role: "admin", audit: "social.google.disconnect" }, async (ctx) => {
  await removeConnectionSecrets(ctx.workspace.id, GOOGLE_ACCOUNT, ["refreshToken", "email", "scopes"]);
  revalidate();
});

export const syncSeoNowAction = action({ schema: z.object({}), role: "member" }, async (ctx) => {
  const s = await syncSeo(ctx.workspace.id);
  revalidate();
  return { message: `Search Console: ${s.top.length} top queries, ${s.opportunities.length} keyword opportunities (${s.from} – ${s.to}).` };
});
