import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { currentUser } from "@/lib/session";
import { TRIAL_MAX_PAGES } from "@/lib/plans";

export const metadata = { title: "Create account — MedChrono AI" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/workspace" } = await searchParams;
  if (await currentUser()) redirect("/workspace");
  return (
    <AuthShell title="Start free" subtitle={`Your first case (up to ${TRIAL_MAX_PAGES} pages) is free. No card required.`}>
      <AuthForm mode="signup" next={next} />
    </AuthShell>
  );
}
