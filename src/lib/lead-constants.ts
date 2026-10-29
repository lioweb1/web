export const LEAD_STATUSES = [
  ["new", "New"],
  ["reviewed", "Reviewed"],
  ["qualified", "Qualified"],
  ["contacted", "Contacted"],
  ["follow_up", "Follow-up Required"],
  ["replied", "Replied"],
  ["meeting", "Meeting Scheduled"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["not_interested", "Not Interested"],
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number][0];
export const statusLabel = (s: string) => LEAD_STATUSES.find(([k]) => k === s)?.[1] ?? s;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const SIGNAL_LABELS: Record<string, string> = {
  business_launch: "Business launch",
  website_requirement: "Website requirement",
  redesign_requirement: "Redesign requirement",
  ecommerce_requirement: "eCommerce requirement",
  hosting_migration: "Hosting / migration",
  general_update: "General business update",
  new_registration: "New registration",
  new_domain: "New domain / certificate",
  no_website: "No website listed",
  website_issues: "Website issues",
};
