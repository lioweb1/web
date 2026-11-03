import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "./logo";

export function AppHeader({ current }: { current: "billing" | "team" }) {
  const tab = (href: string, label: string, key: string) => (
    <Link href={href} className={`rounded-lg px-3 py-1.5 ${current === key ? "bg-navy text-white" : "text-muted hover:text-ink"}`}>{label}</Link>
  );
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Logo href="/workspace" />
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/workspace" className="mr-2 hidden items-center gap-1.5 text-muted hover:text-ink sm:inline-flex"><ArrowLeft className="h-4 w-4" /> Workspace</Link>
          {tab("/team", "Team", "team")}
          {tab("/billing", "Billing", "billing")}
        </nav>
      </div>
    </header>
  );
}
