import { requireAuth } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/card";

export default async function Dashboard() {
  const ctx = await requireAuth();
  return <PageHeader title="Dashboard" description={`Workspace ${ctx.workspace.name}`} />;
}
