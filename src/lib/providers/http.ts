/**
 * Outbound HTTP for provider integrations: identifying User-Agent, timeouts,
 * per-host politeness spacing, retries with exponential backoff on 429/5xx,
 * and a response size cap. Injectable so tests can replay recorded responses.
 */
export type HttpResponse = {
  status: number;
  ok: boolean;
  url: string;
  headers: Headers;
  text: string;
  elapsedMs: number;
};

export type HttpRequest = {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Minimum ms between requests to the same host (provider fair-use). */
  minIntervalMs?: number;
  retries?: number;
  maxBytes?: number;
  redirect?: "follow" | "manual";
};

export type HttpClient = (url: string, req?: HttpRequest) => Promise<HttpResponse>;

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export function userAgent() {
  const contact = process.env.PROVIDER_CONTACT_EMAIL;
  const app = process.env.APP_URL ?? "https://github.com/";
  return `LeadOrbitAI/0.1 (+${app}${contact ? `; ${contact}` : ""})`;
}

const lastRequestAt = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeWait(host: string, minIntervalMs: number) {
  if (!minIntervalMs) return;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  lastRequestAt.set(host, Math.max(Date.now(), last + minIntervalMs));
  if (wait > 0) await sleep(wait);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export const defaultHttp: HttpClient = async (url, req = {}) => {
  const { method = "GET", timeoutMs = 20_000, minIntervalMs = 0, retries = 2, maxBytes = 3_000_000 } = req;
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    await politeWait(host, minIntervalMs);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: { "User-Agent": userAgent(), Accept: "*/*", ...req.headers },
        body: req.body,
        redirect: req.redirect ?? "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = method === "HEAD" ? "" : await readCapped(res, maxBytes);
      const out = { status: res.status, ok: res.ok, url: res.url || url, headers: res.headers, text, elapsedMs: Date.now() - started };
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      return out;
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      const msg = err instanceof Error ? (err.name === "TimeoutError" ? `Timed out after ${timeoutMs}ms` : err.message) : String(err);
      throw new ProviderHttpError(`Request to ${host} failed: ${msg}`, null, true);
    }
  }
};

export function assertOk(res: HttpResponse, provider: string) {
  if (res.ok) return;
  const retryable = res.status === 429 || res.status >= 500;
  const hint = res.status === 401 || res.status === 403 ? " (check the API key / access permissions)" : res.status === 429 ? " (rate limited by provider)" : "";
  throw new ProviderHttpError(`${provider} responded with HTTP ${res.status}${hint}`, res.status, retryable);
}

export function parseJson<T>(res: HttpResponse, provider: string): T {
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new ProviderHttpError(`${provider} returned a response that is not valid JSON`, res.status, res.status >= 500);
  }
}
