import { withTenant, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/crypto";
import { getIntegrationRow } from "@/lib/services/integrations";
import type { FieldDef } from "@/lib/providers/types";

/**
 * Social autopilot connections: AI writers and publishing accounts. Credentials live in the
 * `integrations` table under "ai:*" / "social:*" ids, encrypted like data-source keys.
 */
export type SocialConnectionDef = {
  id: string;
  kind: "ai" | "platform";
  name: string;
  description: string;
  pricingNote: string;
  docsUrl: string;
  secretFields: FieldDef[];
  settingFields: FieldDef[];
};

export const AI_PROVIDERS: SocialConnectionDef[] = [
  {
    id: "gemini",
    kind: "ai",
    name: "Google Gemini",
    description: "Default writer. Create a free API key in Google AI Studio.",
    pricingNote: "Free tier with per-minute and per-day limits (check AI Studio for current limits). Free-tier prompts may be used by Google to improve its products.",
    docsUrl: "https://aistudio.google.com/apikey",
    secretFields: [{ key: "apiKey", label: "API key", type: "secret", required: true }],
    settingFields: [{ key: "model", label: "Model", type: "text", help: "Default: gemini-flash-latest" }],
  },
  {
    id: "groq",
    kind: "ai",
    name: "Groq",
    description: "Fast open models (Llama and others) through an OpenAI-compatible API.",
    pricingNote: "Free tier with rate limits.",
    docsUrl: "https://console.groq.com/keys",
    secretFields: [{ key: "apiKey", label: "API key", type: "secret", required: true }],
    settingFields: [{ key: "model", label: "Model", type: "text", help: "Default: llama-3.3-70b-versatile" }],
  },
  {
    id: "openrouter",
    kind: "ai",
    name: "OpenRouter",
    description: "One key for many models. Model ids ending in :free cost nothing.",
    pricingNote: "Free models available with daily limits.",
    docsUrl: "https://openrouter.ai/keys",
    secretFields: [{ key: "apiKey", label: "API key", type: "secret", required: true }],
    settingFields: [{ key: "model", label: "Model", type: "text", help: "Default: meta-llama/llama-3.3-70b-instruct:free" }],
  },
  {
    id: "ollama",
    kind: "ai",
    name: "Ollama (self-hosted)",
    description: "Runs a model on your own server. The server address is set by the OLLAMA_URL environment variable.",
    pricingNote: "Free; needs enough RAM/GPU for the model.",
    docsUrl: "https://ollama.com",
    secretFields: [],
    settingFields: [{ key: "model", label: "Model", type: "text", help: "Default: llama3.1" }],
  },
];

export const SOCIAL_PLATFORMS: SocialConnectionDef[] = [
  {
    id: "facebook",
    kind: "platform",
    name: "Facebook Page",
    description: "Posts to a Facebook Page you manage (not a personal profile). Needs a Page access token with pages_manage_posts.",
    pricingNote: "Free (Meta Graph API).",
    docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
    secretFields: [{ key: "accessToken", label: "Page access token", type: "secret", required: true }],
    settingFields: [{ key: "pageId", label: "Page ID", type: "text", required: true }],
  },
  {
    id: "instagram",
    kind: "platform",
    name: "Instagram (Business / Creator)",
    description: "Instagram only accepts posts with an image. Each post uses its own image URL, or the default below. Links in captions are not clickable, so the CTA says “link in bio”.",
    pricingNote: "Free (Instagram Graph API).",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    secretFields: [{ key: "accessToken", label: "Access token", type: "secret", required: true }],
    settingFields: [
      { key: "igUserId", label: "Instagram user ID", type: "text", required: true },
      { key: "defaultImageUrl", label: "Default image URL", type: "text", help: "Public JPEG URL used when a post has no image." },
    ],
  },
  {
    id: "threads",
    kind: "platform",
    name: "Threads",
    description: "Text posts up to 500 characters.",
    pricingNote: "Free (Threads API).",
    docsUrl: "https://developers.facebook.com/docs/threads/posts",
    secretFields: [{ key: "accessToken", label: "Access token", type: "secret", required: true }],
    settingFields: [],
  },
  {
    id: "bluesky",
    kind: "platform",
    name: "Bluesky",
    description: "Posts up to 300 characters. Use an app password (Settings → Privacy and security → App passwords), never your main password. Also used to search Bluesky for trends.",
    pricingNote: "Free (AT Protocol).",
    docsUrl: "https://docs.bsky.app/docs/advanced-guides/posts",
    secretFields: [{ key: "appPassword", label: "App password", type: "secret", required: true }],
    settingFields: [{ key: "handle", label: "Handle", type: "text", required: true, help: "e.g. yourname.bsky.social" }],
  },
  {
    id: "mastodon",
    kind: "platform",
    name: "Mastodon",
    description: "Posts to your account on any Mastodon instance. Create a token under Preferences → Development with the write:statuses scope.",
    pricingNote: "Free.",
    docsUrl: "https://docs.joinmastodon.org/methods/statuses/#create",
    secretFields: [{ key: "accessToken", label: "Access token", type: "secret", required: true }],
    settingFields: [{ key: "instanceUrl", label: "Instance URL", type: "text", required: true, help: "e.g. https://mastodon.social" }],
  },
  {
    id: "telegram",
    kind: "platform",
    name: "Telegram channel",
    description: "Posts to a channel through a bot you create with @BotFather (add the bot to the channel as an admin). The same bot can send you every draft and reply with Approve / Publish now / Reject buttons, so you can run the autopilot from your phone.",
    pricingNote: "Free (Telegram Bot API).",
    docsUrl: "https://core.telegram.org/bots/api#sendmessage",
    secretFields: [{ key: "botToken", label: "Bot token", type: "secret", required: true }],
    settingFields: [
      { key: "chatId", label: "Channel to post to", type: "text", help: "@channelname or numeric chat id. Leave blank to use the bot for approvals only." },
      { key: "approverChatId", label: "Your chat ID for approvals", type: "text", help: "Send /start to your bot, then get your numeric ID from @userinfobot. Only this chat can approve." },
    ],
  },
  {
    id: "discord",
    kind: "platform",
    name: "Discord channel",
    description: "Posts to a Discord channel through a webhook (Channel settings → Integrations → Webhooks).",
    pricingNote: "Free.",
    docsUrl: "https://discord.com/developers/docs/resources/webhook#execute-webhook",
    secretFields: [{ key: "webhookUrl", label: "Webhook URL", type: "secret", required: true }],
    settingFields: [],
  },
  {
    id: "linkedin",
    kind: "platform",
    name: "LinkedIn (personal profile)",
    description: "Needs a LinkedIn app with “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect”, and a member access token with w_member_social. Tokens expire after about 60 days.",
    pricingNote: "Free.",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin",
    secretFields: [{ key: "accessToken", label: "Access token", type: "secret", required: true }],
    settingFields: [],
  },
];

export const ALL_CONNECTIONS = [...AI_PROVIDERS, ...SOCIAL_PLATFORMS];

export function connectionKey(def: Pick<SocialConnectionDef, "kind" | "id">) {
  return `${def.kind === "ai" ? "ai" : "social"}:${def.id}`;
}

export function getConnectionDef(kind: "ai" | "platform", id: string) {
  return (kind === "ai" ? AI_PROVIDERS : SOCIAL_PLATFORMS).find((d) => d.id === id);
}

export type Connection = { secrets: Record<string, string>; settings: Record<string, string>; enabled: boolean; configured: boolean };

export type ConnectionView = {
  id: string;
  kind: "ai" | "platform";
  enabled: boolean;
  configured: boolean;
  connectionStatus: string;
  lastTestedAt: Date | null;
  lastError: string | null;
  settings: Record<string, string>;
  maskedSecrets: Record<string, string | null>;
};

function decode(row: { encryptedSecrets: string | null; settings: Record<string, unknown> } | null) {
  const secrets: Record<string, string> = row?.encryptedSecrets ? JSON.parse(decryptSecret(row.encryptedSecrets)) : {};
  const settings = Object.fromEntries(Object.entries(row?.settings ?? {}).map(([k, v]) => [k, String(v ?? "")]));
  return { secrets, settings };
}

function isConfigured(def: SocialConnectionDef, c: { secrets: Record<string, string>; settings: Record<string, string> }) {
  return def.secretFields.every((f) => !f.required || !!c.secrets[f.key]) && def.settingFields.every((f) => !f.required || !!c.settings[f.key]);
}

export async function getConnection(workspaceId: string, def: SocialConnectionDef): Promise<Connection> {
  const row = await withTenant(workspaceId, (tx) => getIntegrationRow(tx, workspaceId, connectionKey(def)));
  const c = decode(row);
  return { ...c, enabled: row?.enabled ?? false, configured: isConfigured(def, c) };
}

export async function listConnections(workspaceId: string): Promise<ConnectionView[]> {
  const rows = await withTenant(workspaceId, (tx) => tx.select().from(schema.integrations).where(eq(schema.integrations.workspaceId, workspaceId)));
  return ALL_CONNECTIONS.map((def) => {
    const row = rows.find((r) => r.providerId === connectionKey(def)) ?? null;
    const c = decode(row);
    return {
      id: def.id,
      kind: def.kind,
      enabled: row?.enabled ?? false,
      configured: isConfigured(def, c),
      connectionStatus: row?.connectionStatus ?? "untested",
      lastTestedAt: row?.lastTestedAt ?? null,
      lastError: row?.lastError ?? null,
      settings: c.settings,
      maskedSecrets: Object.fromEntries(Object.entries(c.secrets).map(([k, v]) => [k, maskSecret(v)])),
    };
  });
}

/** Save a connection. Blank secret fields keep the stored value; a config change resets the tested status. */
export async function saveConnection(workspaceId: string, def: SocialConnectionDef, input: { enabled: boolean; settings: Record<string, string>; secrets: Record<string, string>; clear?: string[] }) {
  await withTenant(workspaceId, async (tx) => {
    const key = connectionKey(def);
    const existing = await getIntegrationRow(tx, workspaceId, key);
    const { secrets } = decode(existing);
    for (const f of def.secretFields) {
      const v = input.secrets[f.key]?.trim();
      if (v) secrets[f.key] = v;
      if (input.clear?.includes(f.key)) delete secrets[f.key];
    }
    const settings: Record<string, string> = {};
    for (const f of def.settingFields) if (input.settings[f.key] !== undefined) settings[f.key] = input.settings[f.key].trim();
    const encrypted = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
    const configChanged = !existing || existing.encryptedSecrets !== encrypted || JSON.stringify(existing.settings) !== JSON.stringify(settings);
    const values = { enabled: input.enabled, settings, encryptedSecrets: encrypted, ...(configChanged ? { connectionStatus: "untested", lastTestedAt: null } : {}), updatedAt: new Date() };
    if (existing) await tx.update(schema.integrations).set(values).where(eq(schema.integrations.id, existing.id));
    else await tx.insert(schema.integrations).values({ workspaceId, providerId: key, ...values });
  });
}

export async function recordConnectionStatus(workspaceId: string, def: SocialConnectionDef, outcome: { ok: boolean; message: string }, opts: { test?: boolean } = {}) {
  await withTenant(workspaceId, async (tx) => {
    const existing = await getIntegrationRow(tx, workspaceId, connectionKey(def));
    if (!existing) return;
    const now = new Date();
    await tx
      .update(schema.integrations)
      .set({
        ...(opts.test ? { connectionStatus: outcome.ok ? "connected" : "error", lastTestedAt: now } : {}),
        ...(outcome.ok ? { lastSuccessAt: now } : { lastErrorAt: now, lastError: outcome.message.slice(0, 1000) }),
      })
      .where(eq(schema.integrations.id, existing.id));
  });
}
