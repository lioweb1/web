import { Workspace } from "./workspace";
import { requireUser } from "@/lib/session";
import { hasApiKey } from "@/lib/extract";

export const metadata = { title: "Workspace — MedChrono AI" };

export default async function WorkspacePage() {
  const u = await requireUser("/workspace");
  return (
    <Workspace
      mode="app"
      live={hasApiKey()}
      account={{
        name: u.name,
        firm: u.org.name,
        plan: u.org.plan,
        credits: { trial: u.org.trial_credits, plan: u.org.plan_credits, purchased: u.org.purchased_credits },
      }}
    />
  );
}
