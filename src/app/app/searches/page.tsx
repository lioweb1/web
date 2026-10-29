import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Bookmark } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { fmtDate, fmtRelative } from "@/components/ui/misc";
import { renameSearchAction, deleteSearchAction, clearHistoryAction } from "./actions";

export const metadata = { title: "Saved searches" };

/** Human summary of a serialized leads query. */
function describe(query: string) {
  const p = new URLSearchParams(query);
  const parts: string[] = [];
  for (const [k, v] of p) parts.push(k === "q" ? `"${v}"` : `${k}: ${v.length > 40 ? `${v.slice(0, 40)}…` : v}`);
  return parts.join(" · ") || "All leads";
}

export default async function SearchesPage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const canEdit = hasRole(ctx, "member");
  const { saved, history } = await withTenant(ws, async (tx) => ({
    saved: await tx.select().from(schema.savedSearches).where(eq(schema.savedSearches.workspaceId, ws)).orderBy(desc(schema.savedSearches.updatedAt)),
    history: await tx
      .select()
      .from(schema.searchHistory)
      .where(and(eq(schema.searchHistory.workspaceId, ws), eq(schema.searchHistory.userId, ctx.user.id)))
      .orderBy(desc(schema.searchHistory.createdAt))
      .limit(30),
  }));
  return (
    <>
      <PageHeader title="Saved searches" description="Reusable lead filters for your workspace. Turn any search into a monitoring rule to get notified when new matching businesses are found." />
      <Card className="mb-6">
        <CardHeader title={`Saved (${saved.length})`} />
        {saved.length === 0 ? (
          <EmptyState icon={<Bookmark className="size-5" />} title="No saved searches" description="Filter the Leads table, then click “Save search”." action={<Button asChild><Link href="/app/leads">Go to leads</Link></Button>} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Filters</TH>
                <TH>Updated</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <tbody>
              {saved.map((s) => (
                <TR key={s.id}>
                  <TD>
                    {canEdit ? (
                      <form action={renameSearchAction} className="flex gap-1">
                        <input type="hidden" name="id" value={s.id} />
                        <Input name="name" defaultValue={s.name} aria-label="Search name" className="h-8 min-w-40" maxLength={80} required />
                        <Button size="sm" variant="ghost" type="submit">
                          Rename
                        </Button>
                      </form>
                    ) : (
                      s.name
                    )}
                  </TD>
                  <TD className="max-w-md text-xs text-muted">{describe(s.query)}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted">{fmtDate(s.updatedAt)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" asChild variant="primary">
                        <Link href={`/app/leads?${s.query}`}>Open</Link>
                      </Button>
                      <Button size="sm" asChild>
                        <Link href={`/app/monitoring/new?fromSearch=${encodeURIComponent(s.query)}&name=${encodeURIComponent(s.name)}`}>Create rule</Link>
                      </Button>
                      {canEdit ? (
                        <ConfirmDialog trigger={<Button size="sm" variant="ghost" className="text-danger">Delete</Button>} title={`Delete "${s.name}"?`} description="Monitoring rules created from it are not affected." confirmLabel="Delete" action={deleteSearchAction} hidden={{ id: s.id }} />
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Recent search history"
          description="Your last 30 lead searches (only visible to you)."
          action={
            history.length ? (
              <form action={clearHistoryAction}>
                <Button size="sm" variant="ghost" type="submit">
                  Clear history
                </Button>
              </form>
            ) : null
          }
        />
        {history.length === 0 ? (
          <EmptyState title="No searches yet" />
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <Link href={`/app/leads?${h.query}`} className="min-w-0 truncate text-accent hover:underline">
                  {describe(h.query)}
                </Link>
                <span className="text-xs text-muted">
                  {h.resultCount ?? "?"} results · {fmtRelative(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
