"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { action, simpleAction, zArr, zOptDate, UserError } from "@/lib/action";
import { schema, withTenant } from "@/lib/db";
import { LEAD_STATUSES, PRIORITIES } from "@/lib/lead-constants";
import { addNote, addToList, archiveLeads, completeTask, createTask, deleteLeads, logCommunication, mergeLeads, tagLeads, updateLeads } from "@/lib/services/leads";
import { enqueue } from "@/lib/jobs/queue";
import { rescoreLead } from "@/lib/services/enrich";
import { providerContext } from "@/lib/services/integrations";
import { suppressBusiness } from "@/lib/services/accounts";
import { fireLeadEvent } from "@/lib/jobs/handlers";
import { importLeads, IMPORT_FIELDS, type ColumnMapping } from "@/lib/services/import";

const statusEnum = z.enum(LEAD_STATUSES.map(([k]) => k) as [string, ...string[]]);
const ids = zArr.pipe(z.array(z.string().uuid()).min(1, "Select at least one lead").max(1000));

/* ------------------------------ bulk ------------------------------ */

async function fireStatusEvents(ws: string, changed: { id: string; from: string; to: string }[]) {
  if (!changed.length) return;
  const rows = await withTenant(ws, (tx) => tx.select({ id: schema.leads.id, score: schema.leads.score }).from(schema.leads).where(inArray(schema.leads.id, changed.map((c) => c.id))));
  for (const c of changed) await fireLeadEvent(ws, c.id, "lead.status_changed", rows.find((r) => r.id === c.id)?.score ?? 0, { from: c.from, to: c.to });
}

export const bulkLeadsAction = action(
  {
    role: "member",
    audit: "leads.bulk",
    schema: z.object({
      ids,
      op: z.enum(["status", "priority", "owner", "tag_add", "tag_remove", "list", "archive", "restore", "delete", "merge"]),
      value: z.string().max(100).optional(),
    }),
  },
  async (ctx, { ids, op, value }) => {
    const ws = ctx.workspace.id;
    let message = "";
    switch (op) {
      case "status": {
        const status = statusEnum.parse(value);
        const changed = await updateLeads(ws, ctx.user.id, ids, { status: status as never });
        await fireStatusEvents(ws, changed);
        message = `Status updated for ${ids.length} lead(s).`;
        break;
      }
      case "priority":
        await updateLeads(ws, ctx.user.id, ids, { priority: z.enum(PRIORITIES).parse(value) });
        message = `Priority updated for ${ids.length} lead(s).`;
        break;
      case "owner":
        await updateLeads(ws, ctx.user.id, ids, { ownerUserId: value && value !== "none" ? z.string().uuid().parse(value) : null });
        message = `Owner updated for ${ids.length} lead(s).`;
        break;
      case "tag_add":
      case "tag_remove": {
        const tag = z.string().trim().min(1, "Enter a tag name").max(40).parse(value);
        await tagLeads(ws, ids, tag, op === "tag_remove");
        message = `${op === "tag_add" ? "Tagged" : "Untagged"} ${ids.length} lead(s) "${tag}".`;
        break;
      }
      case "list":
        await addToList(ws, ids, z.string().uuid("Choose a list").parse(value));
        message = `Added ${ids.length} lead(s) to the list.`;
        break;
      case "archive":
      case "restore":
        await archiveLeads(ws, ctx.user.id, ids, op === "archive");
        message = `${op === "archive" ? "Archived" : "Restored"} ${ids.length} lead(s).`;
        break;
      case "delete":
        if (ctx.role === "member" && ids.length > 50) throw new UserError("Members can delete up to 50 leads at once; ask an admin for larger deletions.");
        message = `Deleted ${await deleteLeads(ws, ids)} lead(s).`;
        break;
      case "merge": {
        const target = value && ids.includes(value) ? value : ids[0];
        await mergeLeads(ws, ctx.user.id, target, ids);
        message = `Merged ${ids.length - 1} duplicate(s) into one lead.`;
        break;
      }
    }
    revalidatePath("/app/leads");
    return { ok: true, message };
  },
);

export const saveSearchAction = action(
  { role: "member", schema: z.object({ name: z.string().trim().min(1, "Name the search").max(80), query: z.string().max(4000) }) },
  async (ctx, { name, query }) => {
    await withTenant(ctx.workspace.id, (tx) => tx.insert(schema.savedSearches).values({ workspaceId: ctx.workspace.id, userId: ctx.user.id, name, query }));
    revalidatePath("/app/searches");
    return { ok: true, message: `Saved search "${name}".` };
  },
);

export const createListAction = action(
  { role: "member", schema: z.object({ name: z.string().trim().min(1, "Name the list").max(80), description: z.string().max(300).optional() }) },
  async (ctx, { name, description }) => {
    await withTenant(ctx.workspace.id, (tx) => tx.insert(schema.leadLists).values({ workspaceId: ctx.workspace.id, name, description: description || null }));
    revalidatePath("/app/leads");
    return { ok: true, message: `List "${name}" created.` };
  },
);

/* ---------------------------- single lead ---------------------------- */

const leadId = z.string().uuid();
const done = (id: string) => revalidatePath(`/app/leads/${id}`);

export const updateLeadAction = action(
  {
    role: "member",
    schema: z.object({
      leadId,
      status: statusEnum,
      priority: z.enum(PRIORITIES),
      ownerUserId: z.string().optional(),
      followUpAt: zOptDate,
    }),
  },
  async (ctx, i) => {
    const changed = await updateLeads(ctx.workspace.id, ctx.user.id, [i.leadId], {
      status: i.status as never,
      priority: i.priority,
      ownerUserId: i.ownerUserId && i.ownerUserId !== "none" ? z.string().uuid().parse(i.ownerUserId) : null,
      followUpAt: i.followUpAt,
    });
    await fireStatusEvents(ctx.workspace.id, changed);
    done(i.leadId);
    return { ok: true, message: "Lead updated." };
  },
);

export const addNoteAction = action({ role: "member", schema: z.object({ leadId, body: z.string().trim().min(1, "Write a note").max(10000) }) }, async (ctx, i) => {
  await addNote(ctx.workspace.id, ctx.user.id, i.leadId, i.body);
  done(i.leadId);
  return { ok: true, message: "Note added." };
});

export const editNoteAction = simpleAction({ role: "member", schema: z.object({ leadId, noteId: z.string().uuid(), body: z.string().trim().min(1).max(10000) }) }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) =>
    tx.update(schema.notes).set({ body: i.body, updatedAt: new Date() }).where(and(eq(schema.notes.id, i.noteId), eq(schema.notes.workspaceId, ctx.workspace.id))),
  );
  done(i.leadId);
});

export const deleteNoteAction = simpleAction({ role: "member", schema: z.object({ leadId, noteId: z.string().uuid() }) }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) => tx.delete(schema.notes).where(and(eq(schema.notes.id, i.noteId), eq(schema.notes.workspaceId, ctx.workspace.id))));
  done(i.leadId);
});

export const logCommunicationAction = action(
  { role: "member", schema: z.object({ leadId, kind: z.enum(["email", "call", "meeting", "message"]), summary: z.string().trim().min(1, "Describe the interaction").max(2000), occurredAt: zOptDate }) },
  async (ctx, i) => {
    await logCommunication(ctx.workspace.id, ctx.user.id, i.leadId, i.kind, i.summary, i.occurredAt ?? new Date());
    done(i.leadId);
    return { ok: true, message: "Interaction logged." };
  },
);

export const tagLeadAction = simpleAction({ role: "member", schema: z.object({ leadId, tag: z.string().trim().min(1).max(40), remove: z.string().optional() }) }, async (ctx, i) => {
  await tagLeads(ctx.workspace.id, [i.leadId], i.tag, i.remove === "1");
  done(i.leadId);
});

export const listLeadAction = simpleAction({ role: "member", schema: z.object({ leadId, listId: z.string().uuid(), remove: z.string().optional() }) }, async (ctx, i) => {
  if (i.remove === "1")
    await withTenant(ctx.workspace.id, (tx) => tx.delete(schema.leadListItems).where(and(eq(schema.leadListItems.leadId, i.leadId), eq(schema.leadListItems.listId, i.listId))));
  else await addToList(ctx.workspace.id, [i.leadId], i.listId);
  done(i.leadId);
});

export const createTaskAction = action(
  { role: "member", schema: z.object({ leadId, title: z.string().trim().min(1, "Describe the task").max(300), dueAt: zOptDate, assigneeId: z.string().optional() }) },
  async (ctx, i) => {
    await createTask(ctx.workspace.id, ctx.user.id, { leadId: i.leadId, title: i.title, dueAt: i.dueAt, assigneeId: i.assigneeId && i.assigneeId !== "none" ? z.string().uuid().parse(i.assigneeId) : null });
    done(i.leadId);
    return { ok: true, message: "Task created." };
  },
);

export const completeTaskAction = simpleAction({ role: "member", schema: z.object({ leadId, taskId: z.string().uuid(), done: z.string() }) }, async (ctx, i) => {
  await completeTask(ctx.workspace.id, ctx.user.id, i.taskId, i.done === "1");
  done(i.leadId);
});

export const reanalyzeAction = simpleAction({ role: "member", schema: z.object({ leadId }) }, async (ctx, i) => {
  await enqueue({ type: "enrich_lead", workspaceId: ctx.workspace.id, payload: { leadId: i.leadId, analyze: true }, idempotencyKey: `enrich:manual:${i.leadId}:${Math.floor(Date.now() / 60_000)}` });
  await withTenant(ctx.workspace.id, (tx) => tx.insert(schema.activities).values({ workspaceId: ctx.workspace.id, leadId: i.leadId, actorId: ctx.user.id, kind: "system", summary: "Enrichment & website analysis queued" }));
  done(i.leadId);
});

export const rescoreAction = simpleAction({ role: "member", schema: z.object({ leadId }) }, async (ctx, i) => {
  await rescoreLead(ctx.workspace.id, i.leadId);
  done(i.leadId);
});

export const hubspotAction = simpleAction({ role: "member", audit: "lead.crm_push", schema: z.object({ leadId }) }, async (ctx, i) => {
  const hub = await providerContext(ctx.workspace.id, "hubspot");
  if (!hub.enabled || !hub.configured) throw new UserError("HubSpot is not configured. Add a private app token under Data sources.");
  await enqueue({ type: "push_crm", workspaceId: ctx.workspace.id, payload: { leadId: i.leadId }, idempotencyKey: `hubspot:manual:${i.leadId}:${Math.floor(Date.now() / 60_000)}` });
  await withTenant(ctx.workspace.id, (tx) => tx.insert(schema.activities).values({ workspaceId: ctx.workspace.id, leadId: i.leadId, actorId: ctx.user.id, kind: "system", summary: "Queued: send to HubSpot" }));
  done(i.leadId);
});

export const archiveLeadAction = simpleAction({ role: "member", schema: z.object({ leadId, archive: z.string() }) }, async (ctx, i) => {
  await archiveLeads(ctx.workspace.id, ctx.user.id, [i.leadId], i.archive === "1");
  done(i.leadId);
});

export async function deleteLeadAction(fd: FormData) {
  const run = simpleAction({ role: "member", audit: "lead.delete", schema: z.object({ leadId }) }, async (ctx, i) => {
    await deleteLeads(ctx.workspace.id, [i.leadId]);
  });
  await run(fd);
  revalidatePath("/app/leads");
  redirect("/app/leads");
}

export const suppressAction = simpleAction({ role: "admin", audit: "business.suppress", schema: z.object({ leadId }) }, async (ctx, i) => {
  const [lead] = await withTenant(ctx.workspace.id, (tx) => tx.select().from(schema.leads).where(eq(schema.leads.id, i.leadId)));
  if (!lead) throw new UserError("Lead not found");
  await suppressBusiness(lead.businessId);
  await withTenant(ctx.workspace.id, (tx) =>
    tx.insert(schema.activities).values({ workspaceId: ctx.workspace.id, leadId: i.leadId, actorId: ctx.user.id, kind: "system", summary: "Contact data suppressed (opt-out / erasure request). Future collection is blocked." }),
  );
  done(i.leadId);
});

/* ------------------------------ import ------------------------------ */

export const importCsvAction = action(
  { role: "member", audit: "leads.import", schema: z.object({ csv: z.string().min(1, "Choose a CSV file").max(5_300_000, "File is larger than 5 MB"), mapping: z.string(), tags: z.string().max(300).optional(), enrich: z.string().optional() }) },
  async (ctx, i) => {
    const raw = JSON.parse(i.mapping) as Record<string, string>;
    const mapping: ColumnMapping = {};
    for (const f of IMPORT_FIELDS) if (raw[f.key]) mapping[f.key] = String(raw[f.key]);
    const res = await importLeads(ctx.workspace.id, ctx.user.id, i.csv, mapping, { tags: (i.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean), enrich: i.enrich === "on" });
    revalidatePath("/app/leads");
    return {
      ok: true,
      message: `Imported ${res.created} lead(s). ${res.duplicates} duplicate(s) skipped, ${res.invalid} invalid row(s).${res.limitReached ? " Stopped: saved-lead limit reached." : ""}`,
      data: { result: res },
    };
  },
);
