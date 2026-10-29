import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import tls from "node:tls";
import type { HttpClient, HttpRequest, HttpResponse } from "@/lib/providers/http";
import { ProviderHttpError } from "@/lib/providers/http";

export type Resolver = (host: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Reject loopback, private, link-local, CGNAT, multicast and reserved ranges (SSRF protection). */
export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff")) return false;
  if (v.startsWith("::ffff:")) return isPublicIp(v.slice(7));
  return true;
}

export async function assertPublicHost(host: string, resolve: Resolver) {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) throw new ProviderHttpError(`Refusing to fetch non-public host ${host}`, null, false);
  const ips = isIP(h) ? [h] : await resolve(h).catch(() => {
    throw new ProviderHttpError(`DNS lookup failed for ${host}`, null, false);
  });
  if (!ips.length || ips.some((ip) => !isPublicIp(ip))) throw new ProviderHttpError(`Refusing to fetch ${host}: resolves to a non-public address`, null, false);
}

/** HTTP GET that validates every redirect hop against SSRF rules. */
export async function safeFetch(http: HttpClient, resolve: Resolver, url: string, req: HttpRequest = {}): Promise<HttpResponse & { redirects: string[] }> {
  const redirects: string[] = [];
  let current = url;
  const started = Date.now();
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(current);
    if (!["http:", "https:"].includes(u.protocol)) throw new ProviderHttpError(`Unsupported protocol ${u.protocol}`, null, false);
    await assertPublicHost(u.hostname, resolve);
    const res = await http(current, { ...req, redirect: "manual", retries: req.retries ?? 0 });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      redirects.push(current);
      current = new URL(loc, current).toString();
      continue;
    }
    return { ...res, url: current, redirects, elapsedMs: Date.now() - started };
  }
  throw new ProviderHttpError("Too many redirects", null, false);
}

export type TlsInfo = { valid: boolean; issuer: string | null; validTo: Date | null; error: string | null };
export type TlsChecker = (host: string) => Promise<TlsInfo>;

export const defaultTlsChecker: TlsChecker = (host) =>
  new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const issuer = cert?.issuer ? ((cert.issuer as Record<string, string>).O ?? (cert.issuer as Record<string, string>).CN ?? null) : null;
      resolve({
        valid: socket.authorized,
        issuer,
        validTo: cert?.valid_to ? new Date(cert.valid_to) : null,
        error: socket.authorized ? null : String(socket.authorizationError ?? "certificate not trusted"),
      });
      socket.end();
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ valid: false, issuer: null, validTo: null, error: "TLS connection timed out" });
    });
    socket.on("error", (e) => resolve({ valid: false, issuer: null, validTo: null, error: e.message }));
  });

/** Minimal robots.txt evaluation for the "*" and "LeadOrbitAI" user agents. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (cur && (key === "allow" || key === "disallow")) {
      if (val) cur.rules.push({ allow: key === "allow", path: val });
      lastWasAgent = false;
    }
  }
  const group = groups.find((g) => g.agents.some((a) => a.includes("leadorbit"))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.len)) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}
