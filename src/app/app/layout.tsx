import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/session";
import { systemDb, schema } from "@/lib/db";
import { Shell } from "@/components/app/shell";
import { GlobalSearch, NotificationBell, ThemeToggle, UserMenu } from "@/components/app/topbar-client";
import { logoutAction } from "../(auth)/actions";
import { switchWorkspaceAction } from "./shared-actions";
import { mergePrefs } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  const db = systemDb();
  const [workspaces, prefs] = await Promise.all([
    db
      .select({ id: schema.workspaces.id, name: schema.workspaces.name, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .where(eq(schema.memberships.userId, ctx.user.id)),
    db.select().from(schema.notificationPrefs).where(and(eq(schema.notificationPrefs.userId, ctx.user.id), eq(schema.notificationPrefs.workspaceId, ctx.workspace.id))),
  ]);
  return (
    <Shell
      topbar={
        <>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell browserEnabled={mergePrefs(prefs[0]?.prefs).browser} />
            <UserMenu name={ctx.user.name} email={ctx.user.email} workspaces={workspaces} activeId={ctx.workspace.id} switchAction={switchWorkspaceAction} logoutAction={logoutAction} />
          </div>
        </>
      }
    >
      {children}
    </Shell>
  );
}
