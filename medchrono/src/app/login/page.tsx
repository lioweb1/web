import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { currentUser } from "@/lib/session";

export const metadata = { title: "Sign in — MedChrono AI" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/workspace" } = await searchParams;
  if (await currentUser()) redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/workspace");
  return (
    <AuthShell title="Sign in" subtitle="Welcome back.">
      <AuthForm mode="login" next={next} />
    </AuthShell>
  );
}
