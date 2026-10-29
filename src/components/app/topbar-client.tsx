"use client";
import * as Popover from "@radix-ui/react-popover";
import * as Menu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Moon, Search, Sun, ChevronDown, Check, LogOut, User } from "lucide-react";
import { cn } from "@/components/ui/cn";

type Notif = { id: string; title: string; body: string | null; type: string; leadId: string | null; sourceUrl: string | null; readAt: string | null; createdAt: string };

export function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative max-w-md flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q")?.toString().trim();
        router.push(q ? `/app/leads?q=${encodeURIComponent(q)}` : "/app/leads");
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input ref={ref} name="q" type="search" placeholder="Search leads, domains, cities, notes…" aria-label="Search leads" className="h-9 w-full rounded-md border border-border bg-surface-2/60 pl-8 pr-12 text-sm placeholder:text-subtle focus:border-ring focus:bg-surface focus:outline-none" />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-subtle sm:block">⌘K</kbd>
    </form>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("theme", next ? "dark" : "light");
        } catch {}
      }}
      className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function NotificationBell({ browserEnabled }: { browserEnabled: boolean }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const lastSeen = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: Notif[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
      const newest = data.items[0];
      if (browserEnabled && newest && !newest.readAt && lastSeen.current && newest.createdAt > lastSeen.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const n = new Notification(newest.title, { body: newest.body ?? undefined, tag: newest.id });
        n.onclick = () => window.open(newest.leadId ? `/app/leads/${newest.leadId}` : "/app/notifications", "_self");
      }
      if (newest) lastSeen.current = newest.createdAt;
    } catch {
      /* offline: keep previous state */
    }
  }, [browserEnabled]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  const markAll = async () => {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read_all" }) });
    load();
  };
  return (
    <Popover.Root onOpenChange={(o) => o && load()}>
      <Popover.Trigger className="relative rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="size-4" />
        {unread ? <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread ? (
              <button onClick={markAll} className="text-xs text-accent hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? <li className="px-3 py-8 text-center text-sm text-muted">No notifications yet. They appear when monitoring rules find qualifying leads.</li> : null}
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-border last:border-0", !n.readAt && "bg-accent-soft/40")}>
                <Link href={n.leadId ? `/app/leads/${n.leadId}` : "/app/notifications"} className="block px-3 py-2.5 hover:bg-surface-2">
                  <p className="line-clamp-1 text-sm font-medium">{n.title}</p>
                  {n.body ? <p className="line-clamp-2 text-xs text-muted">{n.body}</p> : null}
                  <p className="mt-0.5 text-[11px] text-subtle">{new Date(n.createdAt).toLocaleString()}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/app/notifications" className="block border-t border-border px-3 py-2 text-center text-xs text-accent hover:underline">
            View all
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function UserMenu({ name, email, workspaces, activeId, switchAction, logoutAction }: { name: string; email: string; workspaces: { id: string; name: string; role: string }[]; activeId: string; switchAction: (fd: FormData) => void; logoutAction: () => void }) {
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <Menu.Root>
      <Menu.Trigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2" aria-label="Account menu">
        <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">{name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-32 truncate text-left md:block">
          <span className="block truncate text-xs font-medium">{active?.name}</span>
          <span className="block truncate text-[11px] text-muted">{name}</span>
        </span>
        <ChevronDown className="size-3.5 text-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-lg border border-border bg-surface p-1 shadow-xl">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted">{email}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Label className="px-2 py-1 text-[11px] uppercase tracking-wider text-subtle">Workspaces</Menu.Label>
          {workspaces.map((w) => (
            <Menu.Item key={w.id} asChild>
              <form action={switchAction}>
                <input type="hidden" name="workspaceId" value={w.id} />
                <button type="submit" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-surface-2">
                  <Check className={cn("size-4 text-accent", w.id === activeId ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{w.name}</span>
                  <span className="text-[11px] text-subtle">{w.role}</span>
                </button>
              </form>
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item asChild>
            <Link href="/app/settings" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2">
              <User className="size-4" /> Profile & settings
            </Link>
          </Menu.Item>
          <Menu.Item asChild>
            <form action={logoutAction}>
              <button type="submit" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-surface-2">
                <LogOut className="size-4" /> Sign out
              </button>
            </form>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
