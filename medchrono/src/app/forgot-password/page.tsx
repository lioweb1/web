import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Field, JsonForm } from "@/components/json-form";

export const metadata = { title: "Forgot password — MedChrono AI" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your work email and we'll send you a link to choose a new one.">
      <JsonForm
        action="/api/auth/forgot"
        submit="Send reset link"
        successMessage="If an account exists for that email, a reset link is on its way. It expires in 60 minutes — check your spam folder if you don't see it."
      >
        <Field label="Work email" name="email" type="email" required autoComplete="email" />
      </JsonForm>
      <p className="mt-4 text-center text-sm text-muted"><Link href="/login" className="text-teal">Back to sign in</Link></p>
    </AuthShell>
  );
}
