import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getAuth()) redirect("/app/dashboard");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted">Welcome back to LeadOrbit AI.</p>
      <LoginForm next={next} />
    </>
  );
}
