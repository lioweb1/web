"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Radar, Users, Globe, ScanSearch, Megaphone, BellRing, Bookmark, BarChart3, PlugZap, Download, Settings, CreditCard, LifeBuoy, PanelLeftClose, PanelLeftOpen, Menu, X, Activity,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Logo } from "./logo";

const NAV = [
  { section: "Workspace", items: [
    { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/app/discover", label: "Discover", icon: Radar },
    { href: "/app/leads", label: "Leads", icon: Users },
    { href: "/app/signals", label: "Business signals", icon: Megaphone },
  ] },
  { section: "Intelligence", items: [
    { href: "/app/websites", label: "Website analysis", icon: ScanSearch },
    { href: "/app/domains", label: "Domain intelligence", icon: Globe },
    { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  ] },
  { section: "Automation", items: [
    { href: "/app/monitoring", label: "Monitoring rules", icon: BellRing },
    { href: "/app/jobs", label: "Jobs & activity", icon: Activity },
    { href: "/app/searches", label: "Saved searches", icon: Bookmark },
    { href: "/app/exports", label: "Exports", icon: Download },
  ] },
  { section: "Account", items: [
    { href: "/app/integrations", label: "Data sources", icon: PlugZap },
    { href: "/app/settings", label: "Settings", icon: Settings },
    { href: "/app/billing", label: "Usage & plan", icon: CreditCard },
    { href: "/app/help", label: "Help & docs", icon: LifeBuoy },
  ] },
];

export function Shell({ topbar, children }: { topbar: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar") === "collapsed");
    } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  const nav = (compact: boolean) => (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
      {NAV.map((g) => (
        <div key={g.section}>
          {!compact ? <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-subtle">{g.section}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    title={compact ? i.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors", active ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-surface-2 hover:text-fg", compact && "justify-center")}
                  >
                    <i.icon className="size-4 shrink-0" />
                    {!compact ? <span className="truncate">{i.label}</span> : <span className="sr-only">{i.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex", collapsed ? "w-16" : "w-60")}>
        <div className={cn("flex h-14 items-center border-b border-border px-3", collapsed ? "justify-center" : "justify-between")}>
          <Link href="/app/dashboard" aria-label="LeadOrbit AI home">
            <Logo compact={collapsed} />
          </Link>
          {!collapsed ? (
            <button onClick={toggle} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Collapse sidebar">
              <PanelLeftClose className="size-4" />
            </button>
          ) : null}
        </div>
        {nav(collapsed)}
        {collapsed ? (
          <button onClick={toggle} className="m-2 flex justify-center rounded p-2 text-muted hover:bg-surface-2" aria-label="Expand sidebar">
            <PanelLeftOpen className="size-4" />
          </button>
        ) : null}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-950/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-3">
              <Logo />
              <button onClick={() => setMobileOpen(false)} className="rounded p-1 text-muted" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            {nav(false)}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-4">
          <button onClick={() => setMobileOpen(true)} className="rounded p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          {topbar}
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
