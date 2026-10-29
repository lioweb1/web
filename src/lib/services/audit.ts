import { systemDb, schema } from "@/lib/db";

export async function audit(entry: {
  workspaceId: string | null;
  userId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  await systemDb()
    .insert(schema.auditLogs)
    .values({
      workspaceId: entry.workspaceId,
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
    });
}
