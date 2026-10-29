"use client";
import { useActionState, useState } from "react";
import { Checkbox } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { saveLeadsAction } from "./actions";

export type ResultRow = {
  id: string;
  name: string;
  location: string;
  category: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean | null;
  contacts: string[];
  sourceUrl: string | null;
  leadId: string | null;
};

export function DiscoveryResults({ rows, providerId, runId, canSave }: { rows: ResultRow[]; providerId: string; runId: string; canSave: boolean }) {
  const [state, act] = useActionState(saveLeadsAction, null);
  const unsaved = rows.filter((r) => !r.leadId).map((r) => r.id);
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Checkbox label="Select all unsaved" checked={sel.length > 0 && sel.length === unsaved.length} onChange={(e) => setSel(e.currentTarget.checked ? unsaved : [])} disabled={!unsaved.length} />
        <div className="ml-auto flex flex-wrap gap-2">
          <form action={act}>
            <input type="hidden" name="providerId" value={providerId} />
            <input type="hidden" name="runId" value={runId} />
            {sel.map((id) => (
              <input key={id} type="hidden" name="businessIds" value={id} />
            ))}
            <SubmitButton size="sm" disabled={!sel.length || !canSave} pendingText="Saving…">
              Save selected ({sel.length})
            </SubmitButton>
          </form>
          <form action={act}>
            <input type="hidden" name="providerId" value={providerId} />
            {unsaved.map((id) => (
              <input key={id} type="hidden" name="businessIds" value={id} />
            ))}
            <SubmitButton size="sm" variant="secondary" disabled={!unsaved.length || !canSave} pendingText="Saving…">
              Save all unsaved ({unsaved.length})
            </SubmitButton>
          </form>
        </div>
      </div>
      {state ? (
        <div className="px-4 pt-3">
          <FormMessage state={state} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2"><span className="sr-only">Select</span></th>
              <th className="px-3 py-2 font-medium">Business</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Website</th>
              <th className="px-3 py-2 font-medium">Public contacts</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                <td className="px-3 py-2">
                  {!r.leadId ? <input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--accent)]" /> : null}
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted">
                    {r.category ?? "Uncategorized"}
                    {r.sourceUrl ? (
                      <>
                        {" · "}
                        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
                          source
                        </a>
                      </>
                    ) : null}
                  </p>
                </td>
                <td className="px-3 py-2 text-muted">{r.location || "—"}</td>
                <td className="px-3 py-2">
                  {r.websiteUrl ? (
                    <a href={r.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
                      {r.websiteUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
                    </a>
                  ) : r.hasWebsite === false ? (
                    <Badge tone="warning">None listed</Badge>
                  ) : (
                    <span className="text-muted">Unknown</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted">{r.contacts.length ? r.contacts.join(", ") : "—"}</td>
                <td className="px-3 py-2">
                  {r.leadId ? (
                    <a href={`/app/leads/${r.leadId}`} className="text-xs text-accent hover:underline">
                      Saved — view lead
                    </a>
                  ) : (
                    <Badge tone="outline">Not saved</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
