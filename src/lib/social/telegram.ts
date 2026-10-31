import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { httpClient } from "@/lib/services/integrations";
import { telegramCall } from "./publish";
import { approvalTarget, sendCommentForApproval, sendPostForApproval } from "./telegram-notify";
import { DEFAULT_CONFIG, getAutopilot, getPost, queuePublish, regeneratePost, setPostStatus, updatePost } from "./service";
import { regenerateReply, sendReply, updateComment } from "./engage";
import { fmtSlot } from "./format";

type Update = {
  update_id: number;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
  message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string; reply_to_message?: { message_id: number } };
};

/**
 * Poll the approval bot (getUpdates, no public webhook needed) and act on button presses and
 * text replies. Only the configured approver chat is obeyed; everything else is ignored.
 */
export async function pollTelegram(workspaceId: string) {
  const t = await approvalTarget(workspaceId);
  if (!t) return { skipped: true };
  const [ap] = await withTenant(workspaceId, (tx) => tx.select({ offset: schema.socialAutopilots.telegramOffset }).from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, workspaceId)));
  const http = httpClient();
  const updates = await telegramCall<Update[]>(http, t.token, "getUpdates", { offset: ap?.offset ?? undefined, timeout: 0, allowed_updates: ["callback_query", "message"] });
  const { config } = await getAutopilot(workspaceId);
  const say = (text: string, replyTo?: number) => telegramCall(http, t.token, "sendMessage", { chat_id: t.chatId, text, ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}) }).catch(() => null);
  let handled = 0;
  for (const u of updates) {
    try {
      const cq = u.callback_query;
      if (cq && String(cq.from.id) === t.chatId && cq.data) {
        handled++;
        const [kind, action, id] = cq.data.split(":");
        let answer = "Done";
        if (kind === "p") {
          if (action === "s" || action === "n") {
            const at = await queuePublish(workspaceId, id, { when: action === "n" ? "now" : config.scheduleMode === "slots" ? "slot" : "now" });
            answer = action === "n" ? "Publishing now 🚀" : `Scheduled for ${fmtSlot(at, config.timezone)}`;
          } else if (action === "r") {
            await setPostStatus(workspaceId, id, "rejected");
            answer = "Rejected";
          } else if (action === "g") {
            const p = await regeneratePost(workspaceId, id);
            await sendPostForApproval(workspaceId, p, config.link);
            answer = "Rewritten — new version sent";
          }
        } else if (kind === "c") {
          if (action === "s") {
            await sendReply(workspaceId, id);
            answer = "Reply sent ✅";
          } else if (action === "i") {
            await updateComment(workspaceId, id, { status: "ignored" });
            answer = "Ignored";
          } else if (action === "g") {
            const c = await regenerateReply(workspaceId, id);
            const { hook } = await getPost(workspaceId, c.postId);
            await sendCommentForApproval(workspaceId, c, hook);
            answer = "New reply suggested";
          }
        }
        await telegramCall(http, t.token, "answerCallbackQuery", { callback_query_id: cq.id, text: answer.slice(0, 190) }).catch(() => null);
        if (cq.message) {
          await telegramCall(http, t.token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null);
          await say(answer, cq.message.message_id);
        }
        continue;
      }
      const m = u.message;
      if (m?.text && String(m.chat.id) === t.chatId) {
        handled++;
        if (m.text.startsWith("/start")) {
          await say("👋 LeadOrbit approvals are connected. New drafts and comment replies will appear here with buttons.");
          continue;
        }
        const replyTo = m.reply_to_message?.message_id;
        if (!replyTo) continue;
        const [post] = await withTenant(workspaceId, (tx) => tx.select().from(schema.socialPosts).where(and(eq(schema.socialPosts.workspaceId, workspaceId), eq(schema.socialPosts.approvalMessageId, replyTo))));
        if (post) {
          await updatePost(workspaceId, post.id, { body: m.text, platformTexts: {} });
          await sendPostForApproval(workspaceId, await getPost(workspaceId, post.id), config.link);
          continue;
        }
        const [comment] = await withTenant(workspaceId, (tx) => tx.select().from(schema.socialComments).where(and(eq(schema.socialComments.workspaceId, workspaceId), eq(schema.socialComments.approvalMessageId, replyTo))));
        if (comment) {
          await sendReply(workspaceId, comment.id, m.text);
          await say("Your reply was sent ✅", m.message_id);
        }
      }
    } catch (e) {
      await say(`⚠️ ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
    }
  }
  if (updates.length) {
    const offset = updates[updates.length - 1].update_id + 1;
    await withTenant(workspaceId, (tx) =>
      tx
        .insert(schema.socialAutopilots)
        .values({ workspaceId, config: DEFAULT_CONFIG, telegramOffset: offset })
        .onConflictDoUpdate({ target: schema.socialAutopilots.workspaceId, set: { telegramOffset: offset } }),
    );
  }
  return { updates: updates.length, handled };
}
