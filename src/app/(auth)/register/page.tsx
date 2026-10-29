import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { RegisterForm } from "../auth-forms";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getAuth()) redirect("/app/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-muted">Free forever. All built-in data sources are free to use.</p>
      <RegisterForm />
    </>
  );
}
