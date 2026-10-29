"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Input } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { LEAD_STATUSES, PRIORITIES } from "@/lib/lead-constants";
import { bulkLeadsAction } from "@/app/app/leads/actions";
import { cn } from "@/components/ui/cn";

export type TableRow = { id: string; name: string; cells: React.ReactNode[] };

/**
 * Leads table with row selection and a bulk-action bar. Cells are rendered on the server
 * and passed in, so this component only owns selection state.
 */
export function LeadsTable({
  rows,
  headers,
  lists,
  members,
  canEdit,
}: {
  rows: TableRow[];
  headers: React.ReactNode[];
  lists: { id: string; name: string }[];
  members: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, act] = useActionState(bulkLeadsAction, null);
  useEffect(() => {
    if (state?.ok) setSelected([]);
  }, [state]);
  const allOnPage = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleAll = () => setSelected(allOnPage ? [] : rows.map((r) => r.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedRows = useMemo(() => rows.filter((r) => selected.includes(r.id)), [rows, selected]);

  return (
    <div>
      {selected.length > 0 ? (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium text-accent-text">{selected.length} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} aria-label="Clear selection">
            <X /> Clear
          </Button>
          <Button size="sm" asChild>
            <a href={`/api/leads/export?ids=${selected.join(",")}&format=excel`}>
              <Download /> Export selected
            </a>
          </Button>
          {canEdit ? <BulkForm act={act} ids={selected} lists={lists} members={members} selectedRows={selectedRows} /> : null}
        </div>
      ) : null}
      {state ? (
        <div className="px-3 pt-3">
          <FormMessage state={state} />
        </div>
      ) : null}
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs font-medium text-muted">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Select all leads on this page" checked={allOnPage} onChange={toggleAll} className="size-4 accent-[var(--accent)]" />
              </th>
              {headers.map((h, i) => (
                <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-border last:border-0 hover:bg-surface-2/50", selected.includes(r.id) && "bg-accent-soft/40")}>
                <td className="px-3 py-2.5">
                  <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--accent)]" />
                </td>
                {r.cells.map((c, i) => (
                  <td key={i} className="px-3 py-2.5 align-middle">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkForm({ act, ids, lists, members, selectedRows }: { act: (fd: FormData) => void; ids: string[]; lists: { id: string; name: string }[]; members: { id: string; name: string }[]; selectedRows: TableRow[] }) {
  const [op, setOp] = useState("status");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const destructive = op === "delete" || op === "merge";
  const hidden = ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />);
  const valueField =
    op === "status" ? (
      <Select name="value" aria-label="New status" className="h-8 w-44">
        {LEAD_STATUSES.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
    ) : op === "priority" ? (
      <Select name="value" aria-label="Priority" className="h-8 w-32">
        {PRIORITIES.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </Select>
    ) : op === "owner" ? (
      <Select name="value" aria-label="Owner" className="h-8 w-44">
        <option value="none">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    ) : op === "tag_add" || op === "tag_remove" ? (
      <Input name="value" placeholder="Tag name" aria-label="Tag name" className="h-8 w-40" required />
    ) : op === "list" ? (
      <Select name="value" aria-label="List" className="h-8 w-44" required>
        <option value="">Choose list…</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
    ) : op === "merge" ? (
      <Select name="value" aria-label="Keep this lead" className="h-8 w-52">
        {selectedRows.map((r) => (
          <option key={r.id} value={r.id}>
            Keep: {r.name}
          </option>
        ))}
      </Select>
    ) : null;

  return (
    <form id="bulk-form" action={act} className="flex flex-wrap items-center gap-2">
      {hidden}
      <Select name="op" value={op} onChange={(e) => setOp(e.target.value)} aria-label="Bulk action" className="h-8 w-40">
        <option value="status">Set status</option>
        <option value="priority">Set priority</option>
        <option value="owner">Assign owner</option>
        <option value="tag_add">Add tag</option>
        <option value="tag_remove">Remove tag</option>
        <option value="list">Add to list</option>
        <option value="archive">Archive</option>
        <option value="restore">Restore</option>
        <option value="merge" disabled={ids.length < 2}>
          Merge duplicates
        </option>
        <option value="delete">Delete</option>
      </Select>
      {valueField}
      {destructive ? (
        <>
          <Button type="button" size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
            {op === "delete" ? "Delete…" : "Merge…"}
          </Button>
          <Dialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={op === "delete" ? `Delete ${ids.length} lead(s)?` : `Merge ${ids.length} leads?`}
            description={op === "delete" ? "Notes, tasks and activity for these leads are permanently deleted. Shared public business records are kept." : "Notes, activities, tasks, tags and lists move to the kept lead; the other leads are removed."}
          >
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              {/* The dialog is portaled outside the form, so submit via the form attribute. */}
              <Button type="submit" form="bulk-form" variant="danger" onClick={() => setTimeout(() => setConfirmOpen(false), 0)}>
                {op === "delete" ? "Delete permanently" : "Merge"}
              </Button>
            </div>
          </Dialog>
        </>
      ) : (
        <SubmitButton size="sm">Apply</SubmitButton>
      )}
    </form>
  );
}

export function SaveSearchButton({ query, action }: { query: string; action: (prev: import("@/lib/action-types").ActionState, fd: FormData) => Promise<import("@/lib/action-types").ActionState> }) {
  const [state, act] = useActionState(action, null);
  return (
    <Dialog
      title="Save this search"
      description="Saved searches keep the current keyword and filters so you can reopen them or turn them into a monitoring rule."
      trigger={
        <Button size="sm" disabled={!query}>
          Save search
        </Button>
      }
    >
      <form action={act} className="space-y-3">
        <input type="hidden" name="query" value={query} />
        <Input name="name" placeholder="e.g. UK trades without website" aria-label="Search name" required maxLength={80} />
        <FormMessage state={state} />
        <div className="flex justify-between gap-2">
          <Link href={`/app/monitoring/new?fromSearch=${encodeURIComponent(query)}`} className="self-center text-sm text-accent hover:underline">
            Save as monitoring rule instead
          </Link>
          <SubmitButton>Save</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
