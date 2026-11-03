import type { ProviderDefinition } from "./types";

/**
 * The workspace's own SMTP account for one-to-one outreach emails. Any SMTP
 * server works; the help text documents the two free options most people use.
 */
export const outreachEmailProvider: ProviderDefinition = {
  id: "outreach_email",
  name: "Outreach email (your SMTP account)",
  category: "email_sending",
  description:
    "Send one-to-one emails to a lead's published business address from the lead page, over your own SMTP account. Every email carries an unsubscribe link and your postal address; unsubscribes are honored automatically. There is no bulk sending.",
  docsUrl: "/app/help#outreach",
  pricingNote: "Free with a Gmail account + app password (about 500 emails/day) or Resend's free tier (3,000 emails/month via smtp.resend.com). Without this, the server-wide SMTP_* settings are used if present.",
  licenseNote: "You are the sender. Follow anti-spam law where you and the recipient are (e.g. CAN-SPAM, GDPR/PECR, CASL): business addresses only, honest subject lines, a working unsubscribe link and your postal address.",
  refreshNote: "On demand, when you click Send email.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["sent emails", "unsubscribes"],
  secretFields: [{ key: "password", label: "SMTP password / app password / API key", type: "secret", required: true, help: "Gmail: Google Account → Security → 2-Step Verification → App passwords. Resend: use your API key here and 'resend' as the user." }],
  settingFields: [
    { key: "host", label: "SMTP host", type: "text", required: true, placeholder: "smtp.gmail.com or smtp.resend.com" },
    { key: "port", label: "SMTP port", type: "text", placeholder: "587 (STARTTLS) or 465 (TLS)" },
    { key: "user", label: "SMTP user", type: "text", required: true, placeholder: "you@gmail.com, or 'resend'" },
    { key: "from", label: "From address", type: "text", required: true, placeholder: "Your Name <you@yourdomain.com>", help: "Gmail must match the account. Resend requires a domain you verified in Resend." },
    { key: "replyTo", label: "Reply-to (optional)", type: "text", placeholder: "you@yourdomain.com" },
    { key: "dailyLimit", label: "Daily sending limit", type: "text", placeholder: "50", help: "Safety cap per workspace per day (UTC). Gmail allows ~500/day; new accounts should stay far below that." },
    { key: "signature", label: "Signature", type: "textarea", placeholder: "Your Name\nWeb designer, Studio Name\n+1 555 0100 · studio.example", help: "Appended to every outreach email." },
    { key: "postalAddress", label: "Postal address (required by anti-spam law)", type: "textarea", required: true, placeholder: "Studio Name, 12 Example Street, City, Country" },
  ],
  worksWithoutKey: false,
  reliability: 1,
  capabilities: {},
  // The connection test needs nodemailer (Node-only). Provider definitions are also
  // bundled for the browser (source names), so the test lives in services/integrations.ts.
  serverTest: true,
};

export type SmtpConfig = { host: string; port: number; user?: string; password?: string; from: string; replyTo?: string };

export function smtpConfigFrom(settings: Record<string, unknown>, secrets: Record<string, string>): SmtpConfig | null {
  const s = (k: string) => (typeof settings[k] === "string" ? (settings[k] as string).trim() : "");
  const host = s("host");
  const from = s("from");
  const user = s("user");
  if (!host || !from || !user || !secrets.password) return null;
  const port = Number(s("port")) || 587;
  return { host, port, user, password: secrets.password, from, replyTo: s("replyTo") || undefined };
}
