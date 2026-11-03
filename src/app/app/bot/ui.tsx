import { Badge } from "@/components/ui/badge";

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone = outcome === "win" ? "success" : outcome === "loss" ? "danger" : outcome === "tie" ? "neutral" : "warning";
  return <Badge tone={tone}>{outcome}</Badge>;
}

export function pnlClass(n: number) {
  return n > 0 ? "text-success" : n < 0 ? "text-danger" : "text-muted";
}

export function LicenseStatusBadge({ status }: { status: "active" | "revoked" | "expired" }) {
  return <Badge tone={status === "active" ? "success" : status === "revoked" ? "danger" : "warning"}>{status}</Badge>;
}

export const PLAN_LABEL: Record<string, string> = { trial: "Trial (7 days)", monthly: "Monthly", yearly: "Yearly", lifetime: "Lifetime" };
