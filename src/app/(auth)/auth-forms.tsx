"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Input, Field, Checkbox } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { loginAction, registerAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, act] = useActionState(loginAction, null);
  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        New to LeadOrbit?{" "}
        <Link href="/register" className="text-accent hover:underline">
          Create a free account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [state, act] = useActionState(registerAction, null);
  return (
    <form action={act} className="space-y-4">
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field label="Workspace name (optional)" htmlFor="workspaceName">
        <Input id="workspaceName" name="workspaceName" placeholder="e.g. Acme Web Studio" />
      </Field>
      <Checkbox
        name="accept"
        required
        label={
          <span className="text-muted">
            I agree to the{" "}
            <Link href="/terms" className="text-accent hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>
          </span>
        }
      />
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
