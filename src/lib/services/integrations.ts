import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/lib/db";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/crypto";
import { defaultHttp, type HttpClient } from "@/lib/providers/http";
import { getProvider } from "@/lib/providers/registry";
import type { ProviderContext } from "@/lib/providers/types";

export type IntegrationView = {
  providerId: string;
  enabled: boolean;
  connectionStatus: string;
  lastTestedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  requestsToday: number;
  remainingQuota: number | null;
  settings: Record<string, unknown>;
  /** Masked values only — raw secrets never leave the server. */
  maskedSecrets: Record<string, string | null>;
};

let httpOverride: HttpClient | null = null;
/** Tests replace the outbound HTTP client with recorded responses. */
export function setHttpClientForTests(client: HttpClient | null) {
  httpOverride = client;
}
export function httpClient(): HttpClient {
  return httpOverride ?? defaultHttp;
}

export async function getIntegrationRow(tx: Tx, workspaceId: string, providerId: string) {
  const [row] = await tx
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.workspaceId, workspaceId), eq(schema.integrations.providerId, providerId)));
  return row ?? null;
}

function secretsOf(row: { encryptedSecrets: string | null } | null): Record<string, string> {
  if (!row?.encryptedSecrets) return {};
  return JSON.parse(decryptSecret(row.encryptedSecrets));
}

export async function listIntegrations(workspaceId: string): Promise<IntegrationView[]> {
  const rows = await withTenant(workspaceId, (tx) => tx.select().from(schema.integrations).where(eq(schema.integrations.workspaceId, workspaceId)));
  return rows.map((r) => {
    const secrets = secretsOf(r);
    return {
      providerId: r.providerId,
      enabled: r.enabled,
      connectionStatus: r.connectionStatus,
      lastTestedAt: r.lastTestedAt,
      lastSuccessAt: r.lastSuccessAt,
      lastErrorAt: r.lastErrorAt,
      lastError: r.lastError,
      requestsToday: r.requestsDay === new Date().toISOString().slice(0, 10) ? r.requestsToday : 0,
      remainingQuota: r.remainingQuota,
      settings: r.settings,
      maskedSecrets: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, maskSecret(v)])),
    };
  });
}

/** Save configuration. Blank secret fields keep the stored value; changing config resets the tested status. */
export async function saveIntegration(workspaceId: string, providerId: string, input: { enabled: boolean; settings: Record<string, string>; secrets: Record<string, string> }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown provider");
  if (provider.unavailableReason) throw new Error(`${provider.name} cannot be enabled: ${provider.unavailableReason}`);
  await withTenant(workspaceId, async (tx) => {
    const existing = await getIntegrationRow(tx, workspaceId, providerId);
    const secrets = { ...secretsOf(existing) };
    for (const field of provider.secretFields) {
      const v = input.secrets[field.key]?.trim();
      if (v) secrets[field.key] = v;
      if (input.secrets[`${field.key}__clear`] === "1") delete secrets[field.key];
    }
    const settings: Record<string, unknown> = {};
    for (const field of provider.settingFields) if (input.settings[field.key] !== undefined) settings[field.key] = input.settings[field.key].trim();
    const encrypted = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
    const configChanged = !existing || existing.encryptedSecrets !== encrypted || JSON.stringify(existing.settings) !== JSON.stringify(settings);
    const values = {
      enabled: input.enabled,
      settings,
      encryptedSecrets: encrypted,
      ...(configChanged ? { connectionStatus: "untested", lastTestedAt: null } : {}),
      updatedAt: new Date(),
    };
    if (existing) await tx.update(schema.integrations).set(values).where(eq(schema.integrations.id, existing.id));
    else await tx.insert(schema.integrations).values({ workspaceId, providerId, ...values });
  });
}

export async function providerContext(workspaceId: string, providerId: string, since?: Date | null): Promise<ProviderContext & { enabled: boolean; configured: boolean }> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider ${providerId}`);
  const row = await withTenant(workspaceId, (tx) => getIntegrationRow(tx, workspaceId, providerId));
  const secrets = secretsOf(row);
  const configured = provider.secretFields.every((f) => !f.required || !!secrets[f.key]) && provider.settingFields.every((f) => !f.required || !!row?.settings?.[f.key]);
  return {
    http: countingHttp(workspaceId, providerId),
    secrets,
    settings: row?.settings ?? {},
    since,
    // Free key-less sources are enabled unless explicitly disabled.
    enabled: row ? row.enabled : provider.worksWithoutKey && !provider.unavailableReason && provider.defaultEnabled !== false,
    configured,
  };
}

/** Wrap the HTTP client so every provider request is counted against the integration's daily usage. */
function countingHttp(workspaceId: string, providerId: string): HttpClient {
  const base = httpClient();
  return async (url, req) => {
    const res = await base(url, req);
    await bumpUsage(workspaceId, providerId, res.headers.get("x-ratelimit-remaining") ?? res.headers.get("x-ratelimit-remain")).catch(() => {});
    return res;
  };
}

async function bumpUsage(workspaceId: string, providerId: string, remaining: string | null) {
  const day = new Date().toISOString().slice(0, 10);
  const rem = remaining !== null && Number.isFinite(Number(remaining)) ? Number(remaining) : null;
  await withTenant(workspaceId, (tx) =>
    tx.execute(sql`
      insert into integrations (workspace_id, provider_id, enabled, requests_today, requests_day, remaining_quota)
      values (${workspaceId}, ${providerId}, true, 1, ${day}, ${rem})
      on conflict (workspace_id, provider_id) do update set
        requests_today = case when integrations.requests_day = ${day}::date then integrations.requests_today + 1 else 1 end,
        requests_day = ${day}::date,
        remaining_quota = coalesce(${rem}, integrations.remaining_quota)
    `),
  );
}

export async function recordProviderResult(workspaceId: string, providerId: string, result: { ok: true } | { ok: false; error: string }) {
  await withTenant(workspaceId, async (tx) => {
    const now = new Date();
    const existing = await getIntegrationRow(tx, workspaceId, providerId);
    const set = result.ok ? { lastSuccessAt: now } : { lastErrorAt: now, lastError: result.error.slice(0, 1000) };
    if (existing) await tx.update(schema.integrations).set(set).where(eq(schema.integrations.id, existing.id));
    else await tx.insert(schema.integrations).values({ workspaceId, providerId, enabled: true, ...set });
  });
}

/** Run the provider's live connection test. Only a passing test marks an integration "connected". */
export async function testIntegration(workspaceId: string, providerId: string) {
  const provider = getProvider(providerId);
  if (!provider?.test) throw new Error("This integration has no connection test");
  const ctx = await providerContext(workspaceId, providerId);
  let outcome: { ok: boolean; message: string; remainingQuota?: number | null };
  try {
    outcome = await provider.test(ctx);
  } catch (e) {
    outcome = { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  await withTenant(workspaceId, async (tx) => {
    const now = new Date();
    const existing = await getIntegrationRow(tx, workspaceId, providerId);
    const set = {
      connectionStatus: outcome.ok ? "connected" : "error",
      lastTestedAt: now,
      ...(outcome.ok ? { lastSuccessAt: now } : { lastErrorAt: now, lastError: outcome.message.slice(0, 1000) }),
      ...(outcome.remainingQuota != null ? { remainingQuota: outcome.remainingQuota } : {}),
    };
    if (existing) await tx.update(schema.integrations).set(set).where(eq(schema.integrations.id, existing.id));
    else await tx.insert(schema.integrations).values({ workspaceId, providerId, enabled: provider.worksWithoutKey && provider.defaultEnabled !== false, ...set });
  });
  return outcome;
}
