import { Tabs } from "@/components/ui/misc";

export function SocialNav({ active, counts }: { active: "posts" | "calendar" | "comments" | "analytics" | "settings"; counts?: { comments?: number } }) {
  return (
    <Tabs
      active={active}
      tabs={[
        { id: "posts", label: "Posts", href: "/app/social" },
        { id: "calendar", label: "Calendar", href: "/app/social/calendar" },
        { id: "comments", label: "Comments", href: "/app/social/comments", count: counts?.comments },
        { id: "analytics", label: "Analytics", href: "/app/social/analytics" },
        { id: "settings", label: "Settings", href: "/app/social/settings" },
      ]}
    />
  );
}
