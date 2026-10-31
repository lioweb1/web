import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { httpClient } from "@/lib/services/integrations";
import { getConnection, getConnectionDef } from "./accounts";
import { composeText, telegramCall } from "./publish";
import { hookScore } from "./ai";

/** The Telegram bot + personal chat that receives approval requests, if configured. */
export async function approvalTarget(workspaceId: string) {
  const conn = await getConnection(workspaceId, getConnectionDef("platform", "telegram")!);
  const chatId = conn.settings.approverChatId?.trim();
  if (!conn.secrets.botToken || !chatId) return null;
  return { token: conn.secrets.botToken, chatId };
}

const cut = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);

type PostLike = typeof schema.socialPosts.$inferSelect;
type CommentLike = typeof schema.socialComments.$inferSelect;

/** Send a draft to the approver with action buttons. Failures are swallowed: the app UI still works. */
export async function sendPostForApproval(workspaceId: string, post: PostLike, link: string) {
  try {
    const t = await approvalTarget(workspaceId);
    if (!t) return false;
    const preview = composeText("facebook", { hook: post.hook, body: post.body, shortBody: post.shortBody, hashtags: post.hashtags, imageUrl: null, link });
    const alt = post.hookVariants.filter((h) => h !== post.hook).slice(0, 2);
    const text = [
      "📝 New draft",
      `Platforms: ${post.platforms.join(", ") || "none"}${post.primaryKeyword ? ` · SEO: ${post.primaryKeyword}` : ""} · Hook score ${hookScore(post.hook, [post.primaryKeyword ?? ""])}`,
      "",
      cut(preview, 3200),
      alt.length ? `\nOther hooks:\n${alt.map((h) => `• ${h}`).join("\n")}` : "",
      "\nReply to this message with new text to replace the post body.",
    ]
      .filter((l) => l !== "")
      .join("\n");
    const msg = await telegramCall<{ message_id: number }>(httpClient(), t.token, "sendMessage", {
      chat_id: t.chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Schedule", callback_data: `p:s:${post.id}` },
            { text: "🚀 Publish now", callback_data: `p:n:${post.id}` },
          ],
          [
            { text: "🔄 Rewrite", callback_data: `p:g:${post.id}` },
            { text: "❌ Reject", callback_data: `p:r:${post.id}` },
          ],
        ],
      },
    });
    await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ approvalMessageId: msg.message_id }).where(eq(schema.socialPosts.id, post.id)));
    return true;
  } catch {
    return false;
  }
}

export async function sendCommentForApproval(workspaceId: string, comment: CommentLike, postHook: string) {
  try {
    const t = await approvalTarget(workspaceId);
    if (!t || !comment.replyText) return false;
    const msg = await telegramCall<{ message_id: number }>(httpClient(), t.token, "sendMessage", {
      chat_id: t.chatId,
      text: [`💬 New ${comment.platform} comment on “${cut(postHook, 80)}”`, `${comment.authorName ?? comment.authorHandle ?? "Someone"}: ${cut(comment.text, 800)}`, "", `Suggested reply:\n${comment.replyText}`, "\nReply to this message to send your own text instead."].join("\n"),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Send reply", callback_data: `c:s:${comment.id}` },
            { text: "🔄 Rewrite", callback_data: `c:g:${comment.id}` },
            { text: "🙈 Ignore", callback_data: `c:i:${comment.id}` },
          ],
        ],
      },
    });
    await withTenant(workspaceId, (tx) => tx.update(schema.socialComments).set({ approvalMessageId: msg.message_id }).where(eq(schema.socialComments.id, comment.id)));
    return true;
  } catch {
    return false;
  }
}
