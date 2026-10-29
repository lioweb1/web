import type { HttpClient, HttpResponse } from "@/lib/providers/http";

export type Route = { match: string | RegExp; status?: number; body: string | object; headers?: Record<string, string>; delayMs?: number };

/** Replays recorded responses by URL; unmatched requests fail loudly so tests never hit the network. */
export function fakeHttp(routes: Route[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const client: HttpClient = async (url, req = {}) => {
    calls.push({ url, method: req.method ?? "GET", body: req.body });
    const r = routes.find((x) => (typeof x.match === "string" ? url.includes(x.match) : x.match.test(url)));
    if (!r) throw new Error(`fakeHttp: no route for ${req.method ?? "GET"} ${url}`);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    const status = r.status ?? 200;
    const res: HttpResponse = { status, ok: status >= 200 && status < 300, url, headers: new Headers(r.headers ?? {}), text, elapsedMs: r.delayMs ?? 120 };
    return res;
  };
  return { client, calls };
}
