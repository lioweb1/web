import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { lookupUnsubscribeToken } from "@/lib/services/outreach";
import { unsubscribeAction } from "./actions";

export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function mask(email: string) {
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}…@${d}`;
}

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const found = await lookupUnsubscribeToken(token);
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-xl items-center px-4">
          <Link href="/">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-12 text-sm leading-relaxed">
        {!found ? (
          <>
            <h1 className="text-xl font-semibold">This unsubscribe link is not valid</h1>
            <p className="mt-2 text-muted">The link may be incomplete. Reply to the email you received and ask to be removed; the sender is required to honor that.</p>
          </>
        ) : found.alreadyUnsubscribed || done === "1" ? (
          <>
            <h1 className="text-xl font-semibold">You are unsubscribed</h1>
            <p className="mt-2 text-muted">
              {mask(found.message.toEmail)} will not receive further outreach from {found.workspaceName}. Sorry for the interruption.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Unsubscribe from emails by {found.workspaceName}?</h1>
            <p className="mt-2 text-muted">
              Confirm and {mask(found.message.toEmail)} will be added to {found.workspaceName}&apos;s do-not-contact list immediately. No login is required.
            </p>
            <form action={unsubscribeAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <Button type="submit" variant="primary">
                Unsubscribe
              </Button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
