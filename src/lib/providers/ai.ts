import type { ProviderDefinition, ProviderContext } from "./types";
import { assertOk, parseJson } from "./http";

/**
 * AI writing assistants with free tiers. They only ever receive the lead facts
 * LeadOrbit already stores plus the workspace's own outreach profile, and they
 * return text for a human to review, edit and send. Nothing is posted anywhere.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export type AiProviderId = "gemini" | "groq";

export const geminiProvider: ProviderDefinition = {
  id: "gemini",
  name: "Google Gemini (free tier)",
  category: "ai_assistant",
  description: "Writes first drafts of LinkedIn comments, LinkedIn messages and cold emails from the evidence stored on a lead (website issues, technologies, location). You review and send every message yourself.",
  docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
  pricingNote: "Free tier with daily request limits (no card required). Check Google's current rate limits for the chosen model.",
  licenseNote: "Gemini API Terms. On the free tier Google may use prompts to improve its products; do not include personal data you are not allowed to share.",
  refreshNote: "On demand, when you click Generate draft.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["draft text"],
  secretFields: [{ key: "apiKey", label: "API key", type: "secret", required: true, help: "Google AI Studio → Get API key. Keys are encrypted at rest." }],
  settingFields: [{ key: "model", label: "Model", type: "text", help: `Leave empty for ${DEFAULT_GEMINI_MODEL}. Any model listed for your key works.`, placeholder: DEFAULT_GEMINI_MODEL }],
  worksWithoutKey: false,
  reliability: 1,
  capabilities: {},
  async test(ctx) {
    const res = await ctx.http(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(ctx.secrets.apiKey ?? "")}`, { retries: 0, timeoutMs: 15000 });
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: `API key rejected (HTTP ${res.status})` };
    assertOk(res, "Gemini");
    return { ok: true, message: `Gemini API key accepted (model: ${modelOf(ctx, DEFAULT_GEMINI_MODEL)})` };
  },
};

export const groqProvider: ProviderDefinition = {
  id: "groq",
  name: "Groq (free tier)",
  category: "ai_assistant",
  description: "Alternative AI writing assistant running open models (Llama) with a free tier. Used for the same drafts as Gemini when it is enabled and Gemini is not.",
  docsUrl: "https://console.groq.com/docs/quickstart",
  pricingNote: "Free tier with per-minute and per-day request limits (no card required).",
  licenseNote: "Groq Terms of Use and the chosen model's license.",
  refreshNote: "On demand, when you click Generate draft.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["draft text"],
  secretFields: [{ key: "apiKey", label: "API key", type: "secret", required: true, help: "console.groq.com → API Keys. Keys are encrypted at rest." }],
  settingFields: [{ key: "model", label: "Model", type: "text", help: `Leave empty for ${DEFAULT_GROQ_MODEL}.`, placeholder: DEFAULT_GROQ_MODEL }],
  worksWithoutKey: false,
  reliability: 1,
  capabilities: {},
  async test(ctx) {
    const res = await ctx.http("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${ctx.secrets.apiKey ?? ""}` }, retries: 0, timeoutMs: 15000 });
    if (res.status === 401 || res.status === 403) return { ok: false, message: `API key rejected (HTTP ${res.status})` };
    assertOk(res, "Groq");
    return { ok: true, message: `Groq API key accepted (model: ${modelOf(ctx, DEFAULT_GROQ_MODEL)})` };
  },
};

export function modelOf(ctx: Pick<ProviderContext, "settings">, fallback: string) {
  const m = typeof ctx.settings.model === "string" ? ctx.settings.model.trim() : "";
  return m || fallback;
}

export type GenerateInput = { system: string; prompt: string; temperature?: number; maxTokens?: number };
export type GenerateOutput = { text: string; model: string };

/** Call the provider's HTTP API through the workspace's counted HTTP client. */
export async function generateText(providerId: AiProviderId, ctx: ProviderContext, input: GenerateInput): Promise<GenerateOutput> {
  const key = ctx.secrets.apiKey;
  if (!key) throw new Error(`${providerId} is not configured: add an API key under Data sources.`);
  const temperature = input.temperature ?? 0.7;
  const maxTokens = input.maxTokens ?? 700;
  if (providerId === "gemini") {
    const model = modelOf(ctx, DEFAULT_GEMINI_MODEL);
    const res = await ctx.http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
      timeoutMs: 45000,
      retries: 1,
    });
    if (res.status === 429) throw new Error("Gemini free-tier rate limit reached. Wait a minute and try again, or switch the model.");
    assertOk(res, "Gemini");
    const data = parseJson<{ candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }>(res, "Gemini");
    if (data.promptFeedback?.blockReason) throw new Error(`Gemini declined this request (${data.promptFeedback.blockReason}).`);
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty draft. Try again or adjust the context.");
    return { text, model };
  }
  const model = modelOf(ctx, DEFAULT_GROQ_MODEL);
  const res = await ctx.http("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
    }),
    timeoutMs: 45000,
    retries: 1,
  });
  if (res.status === 429) throw new Error("Groq free-tier rate limit reached. Wait a minute and try again.");
  assertOk(res, "Groq");
  const data = parseJson<{ choices?: { message?: { content?: string } }[] }>(res, "Groq");
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Groq returned an empty draft. Try again or adjust the context.");
  return { text, model };
}
