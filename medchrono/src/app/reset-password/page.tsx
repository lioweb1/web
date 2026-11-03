import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Field, JsonForm } from "@/components/json-form";

export const metadata = { title: "Reset password — MedChrono AI" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthShell title="Link missing" subtitle="This page needs the link from your reset email.">
        <Link href="/forgot-password" className="text-teal">Request a new reset link</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out on every other device.">
      <JsonForm action="/api/auth/reset" extra={{ token }} submit="Save new password" redirectTo="/workspace">
        <Field label="New password (10+ characters)" name="password" type="password" required minLength={10} autoComplete="new-password" />
      </JsonForm>
    </AuthShell>
  );
}
