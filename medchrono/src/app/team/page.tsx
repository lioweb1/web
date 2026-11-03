import { AppHeader } from "@/components/app-header";
import { TeamManager } from "@/components/team-manager";
import { seatLimit, teamOverview } from "@/lib/account";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Team — MedChrono AI" };

export default async function TeamPage() {
  const u = await requireUser("/team");
  const { members, invites } = await teamOverview(u.org.id);
  const limit = seatLimit(u.org.plan);
  return (
    <div className="min-h-screen">
      <AppHeader current="team" />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl font-bold">Team</h1>
        <p className="mb-8 mt-1 text-muted">{u.org.name} · everyone on the team shares the firm&apos;s credits.</p>
        <TeamManager
          me={u.id}
          isOwner={u.role === "owner"}
          members={members.map((m) => ({ ...m, created_at: new Date(m.created_at).toISOString() }))}
          invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, invited_by: i.invited_by, expires_at: new Date(i.expires_at).toISOString() }))}
          seats={members.length + invites.length}
          limit={limit}
        />
      </main>
    </div>
  );
}
