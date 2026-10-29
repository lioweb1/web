import { resolveMx as dnsResolveMx, resolve4 } from "node:dns/promises";
import { isValidEmailSyntax } from "@/lib/discovery/normalize";

export type EmailCheck = {
  status: "domain_valid" | "invalid" | "unknown";
  detail: string;
  mx: string[];
};

export type DnsDeps = {
  resolveMx: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  resolveA: (domain: string) => Promise<string[]>;
};

export const defaultDns: DnsDeps = { resolveMx: dnsResolveMx, resolveA: resolve4 };

const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com", "sharklasers.com"]);

/**
 * Syntax + DNS check. "domain_valid" means the domain accepts mail in principle;
 * it does NOT confirm the mailbox exists. Only an email-verification provider can do that.
 */
export async function checkEmail(email: string, dns: DnsDeps = defaultDns): Promise<EmailCheck> {
  if (!isValidEmailSyntax(email)) return { status: "invalid", detail: "Invalid email syntax", mx: [] };
  const domain = email.split("@")[1].toLowerCase();
  if (DISPOSABLE.has(domain)) return { status: "invalid", detail: "Disposable email domain", mx: [] };
  try {
    const mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
    if (mx.length === 1 && (mx[0] === "" || mx[0] === ".")) return { status: "invalid", detail: "Domain publishes a null MX (accepts no email)", mx: [] };
    if (mx.length) return { status: "domain_valid", detail: `Domain has ${mx.length} MX record${mx.length > 1 ? "s" : ""}. Mailbox existence not confirmed.`, mx };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "ENODATA" && code !== "ENOTFOUND") return { status: "unknown", detail: `DNS lookup failed (${code ?? "error"})`, mx: [] };
    if (code === "ENOTFOUND") return { status: "invalid", detail: "Domain does not exist", mx: [] };
  }
  try {
    const a = await dns.resolveA(domain);
    if (a.length) return { status: "domain_valid", detail: "No MX record, but domain has an A record (implicit MX). Mailbox existence not confirmed.", mx: [] };
  } catch {
    /* fall through */
  }
  return { status: "invalid", detail: "Domain has no MX or A records", mx: [] };
}
