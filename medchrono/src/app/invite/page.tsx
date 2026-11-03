import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Field, JsonForm, TermsCheckbox } from "@/components/json-form";
import { inviteInfo } from "@/lib/account";
import { dbConfigured } from "@/lib/db";

export const metadata = { title: "Join your team — MedChrono AI" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const info = token && dbConfigured() ? await inviteInfo(token) : null;
  if (!token || !info) {
    return (
      <AuthShell title="Invitation not valid" subtitle="This invitation link is invalid, expired or already used.">
        <p className="text-sm text-muted">Ask the person who invited you to send a new invitation, or <Link href="/login" className="text-teal">sign in</Link> if you already joined.</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Join ${info.org}`} subtitle={`${info.inviter ?? "Your team"} invited ${info.email} to MedChrono AI.`}>
      <JsonForm action="/api/invite/accept" extra={{ token }} submit="Create my account" redirectTo="/workspace">
        <Field label="Email" value={info.email} disabled readOnly />
        <Field label="Your name" name="name" required autoComplete="name" />
        <Field label="Password (10+ characters)" name="password" type="password" required minLength={10} autoComplete="new-password" />
        <TermsCheckbox />
      </JsonForm>
    </AuthShell>
  );
}
