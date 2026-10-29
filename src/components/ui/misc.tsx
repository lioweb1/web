import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Badge } from "./badge";
import { cn } from "./cn";
import { scoreCategory } from "@/lib/scoring/score";
import { sourceName } from "@/lib/providers/registry";
import { statusLabel } from "@/lib/lead-constants";

export function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const tone = score >= 75 ? "success" : score >= 50 ? "accent" : score >= 25 ? "warning" : "neutral";
  return (
    <Badge tone={tone} className={cn("tabular", size === "md" ? "px-2 text-xs" : "")} title={`${scoreCategory(score)} — qualification category, not a purchase probability`}>
      {score}
    </Badge>
  );
}

export function ScoreBar({ points, max }: { points: number; max: number }) {
  const pct = max ? Math.round((points / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${points} of ${max} points`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs text-muted">
        {points}/{max}
      </span>
    </div>
  );
}

const STATUS_TONES: Record<string, "neutral" | "accent" | "success" | "warning" | "danger" | "info"> = {
  new: "info", reviewed: "neutral", qualified: "accent", contacted: "accent", follow_up: "warning", replied: "success", meeting: "success", won: "success", lost: "danger", not_interested: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{statusLabel(status)}</Badge>;
}

const VERIFICATION: Record<string, { label: string; tone: "success" | "accent" | "neutral" | "danger" | "warning"; help: string }> = {
  verified_by_provider: { label: "Verified by provider", tone: "success", help: "An email verification provider confirmed the mailbox." },
  domain_valid: { label: "Domain valid", tone: "accent", help: "Syntax is valid and the domain accepts email (MX). The mailbox itself is not confirmed." },
  unverified: { label: "Unverified", tone: "neutral", help: "Not checked yet." },
  invalid: { label: "Invalid", tone: "danger", help: "Bad syntax, or the domain cannot receive email." },
  unknown: { label: "Unknown", tone: "warning", help: "The check could not be completed (e.g. DNS timeout)." },
};

export function VerificationBadge({ status }: { status: string }) {
  const v = VERIFICATION[status] ?? VERIFICATION.unknown;
  return (
    <Badge tone={v.tone} title={v.help}>
      {v.label}
    </Badge>
  );
}

export function SourceLink({ providerId, url, date, label }: { providerId: string; url?: string | null; date?: Date | null; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-muted">
      <span>{label ?? "Source"}:</span>
      {url && /^https?:/.test(url) ? (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-accent hover:underline">
          {sourceName(providerId)}
          <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="text-fg">{sourceName(providerId)}</span>
      )}
      {date ? <span>· {fmtDate(date)}</span> : null}
    </span>
  );
}

export function fmtDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", withTime ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" } : { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) + (withTime ? " UTC" : "");
}

export function fmtRelative(d: Date | null | undefined) {
  if (!d) return "never";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const v = a < 60 ? `${a}s` : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`;
  return future ? `in ${v}` : `${v} ago`;
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm" aria-label="Pagination">
      <p className="tabular text-muted">
        {from}–{to} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page">
          <ChevronLeft className="size-4" />
        </PageLink>
        <span className="tabular px-2 text-muted">
          {page} / {pages}
        </span>
        <PageLink href={page < pages ? hrefFor(page + 1) : null} label="Next page">
          <ChevronRight className="size-4" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "inline-flex size-8 items-center justify-center rounded-md border border-border";
  return href ? (
    <Link href={href} aria-label={label} className={cn(cls, "hover:bg-surface-2")}>
      {children}
    </Link>
  ) : (
    <span aria-disabled className={cn(cls, "opacity-40")}>
      {children}
    </span>
  );
}

export function Tabs({ tabs, active }: { tabs: { id: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} role="tab" aria-selected={t.id === active} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.id === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
          {t.count !== undefined ? <span className="tabular ml-1.5 text-xs text-subtle">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export type TimelineItem = { id: string; when: Date; title: React.ReactNode; detail?: React.ReactNode; icon?: React.ReactNode };

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span className="absolute -left-[25px] top-1 flex size-2.5 items-center justify-center rounded-full border-2 border-surface bg-accent" />
          <p className="text-sm text-fg">{i.title}</p>
          {i.detail ? <div className="mt-0.5 text-xs text-muted">{i.detail}</div> : null}
          <p className="mt-0.5 text-xs text-subtle">{fmtDate(i.when, true)}</p>
        </li>
      ))}
    </ol>
  );
}
