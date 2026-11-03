"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UserPlus } from "lucide-react";

type Member = { id: string; name: string; email: string; role: string; created_at: string };
type Invite = { id: string; email: string; role: string; expires_at: string; invited_by: string | null };

async function call(url: string, method: string, body?: object): Promise<{ url?: string }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}

export function TeamManager({ me, isOwner, members, invites, seats, limit }: { me: string; isOwner: boolean; members: Member[]; invites: Invite[]; seats: number; limit: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const [manualLink, setManualLink] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      {isOwner && (
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-semibold">Invite a teammate</h2>
          <p className="mt-1 text-sm text-muted">{seats} of {limit} seats used. Invitations expire after 7 days.</p>
          <form
            className="mt-4 flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const email = String(fd.get("email"));
              act("invite", async () => {
                const r = await call("/api/team/invites", "POST", { email, role: fd.get("role") });
                setSent(email);
                setManualLink(r.url ?? null);
                form.reset();
              });
            }}
          >
            <input name="email" type="email" required placeholder="colleague@firm.com" className="min-w-0 flex-1 basis-56 rounded-lg border border-line px-3 py-2 outline-none focus:border-navy" />
            <select name="role" className="rounded-lg border border-line px-3 py-2 text-sm">
              <option value="member">Member — run cases</option>
              <option value="owner">Owner — also billing & team</option>
            </select>
            <button disabled={busy === "invite"} className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Send invite
            </button>
          </form>
          {sent && !manualLink && <p className="mt-3 text-sm text-teal">Invitation sent to {sent}.</p>}
          {sent && manualLink && (
            <div className="mt-3 rounded-lg bg-warn-soft p-3 text-sm text-warn">
              Email delivery isn&apos;t set up on this server, so send {sent} this link yourself (valid 7 days, works once):
              <div className="mt-2 flex gap-2">
                <input readOnly value={manualLink} className="min-w-0 flex-1 rounded border border-line bg-white px-2 py-1 font-mono text-xs text-ink" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={() => navigator.clipboard?.writeText(manualLink)} className="rounded bg-navy px-3 py-1 text-xs font-medium text-white">Copy</button>
              </div>
            </div>
          )}
        </section>
      )}
      {error && <div className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <h2 className="border-b border-line p-4 font-semibold">Members</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{m.name}{m.id === me && <span className="ml-2 text-xs text-muted">(you)</span>}</div>
                  <div className="text-muted">{m.email}</div>
                </td>
                <td className="px-4 py-3">
                  {isOwner && m.id !== me ? (
                    <select
                      value={m.role}
                      disabled={busy === m.id}
                      onChange={(e) => act(m.id, () => call(`/api/team/members/${m.id}`, "PATCH", { role: e.target.value }))}
                      className="rounded-md border border-line px-2 py-1"
                      aria-label={`Role for ${m.name}`}
                    >
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </select>
                  ) : (
                    <span className="capitalize">{m.role}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {isOwner && m.id !== me && (
                    <button
                      onClick={() => confirm(`Remove ${m.name} from the team? They will be signed out immediately.`) && act(m.id, () => call(`/api/team/members/${m.id}`, "DELETE"))}
                      className="inline-flex items-center gap-1 text-danger"
                      aria-label={`Remove ${m.name}`}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invites.length > 0 && (
        <section className="overflow-x-auto rounded-2xl border border-line bg-white">
          <h2 className="border-b border-line p-4 font-semibold">Pending invitations</h2>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {invites.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{i.email}</div>
                    <div className="text-xs text-muted">Invited by {i.invited_by ?? "—"} · expires {new Date(i.expires_at).toLocaleDateString("en-US")}</div>
                  </td>
                  <td className="px-4 py-3 capitalize">{i.role}</td>
                  <td className="px-4 py-3 text-right">
                    {isOwner && (
                      <button onClick={() => act(i.id, () => call(`/api/team/invites/${i.id}`, "DELETE"))} className="text-danger">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
