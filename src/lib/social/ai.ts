import { z } from "zod";
import { assertOk, parseJson, ProviderHttpError, type HttpClient } from "@/lib/providers/http";
import type { SocialAutopilotConfig } from "@/lib/db/schema";
import type { Connection } from "./accounts";

/** Placeholder the model writes where the link goes; replaced per platform when publishing. */
export const LINK_TOKEN = "{LINK}";

export type TrendInput = { title: string; summary?: string | null; url?: string | null; sourceName: string };

export type GeneratedPost = { hook: string; body: string; shortBody: string; engagementComment: string; hashtags: string[] };

const generatedSchema = z.object({
  hook: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(3000),
  shortBody: z.string().trim().min(1).max(600),
  engagementComment: z.string().trim().max(1000).default(""),
  hashtags: z.array(z.string()).max(10).default([]),
});

type Brand = Pick<SocialAutopilotConfig, "brandName" | "brandVoice" | "language" | "keywords" | "link">;

export function systemPrompt(brand: Brand) {
  return [
    "You are a social media growth copywriter for the brand below. You write scroll-stopping, curiosity-driven posts.",
    `Brand: ${brand.brandName || "(unnamed)"}`,
    brand.brandVoice ? `About the brand / voice: ${brand.brandVoice}` : "",
    brand.keywords.length ? `Niche: ${brand.keywords.join(", ")}` : "",
    `Write in ${brand.language || "English"}.`,
    "",
    "Rules:",
    "1. Open with a powerful hook that creates a curiosity gap or FOMO. No boring introductions.",
    "2. Casual, punchy, emotional tone. Short lines, line breaks and a few well-placed emojis.",
    `3. End with a call to action that points to the link. Write the literal token ${LINK_TOKEN} where the link goes (e.g. "Check it out 👉 ${LINK_TOKEN}"). Use it exactly once in body and once in shortBody.`,
    "4. The source item is only inspiration for the TOPIC. Write a completely original post: never copy its sentences, never quote or name its author, never pretend to be them.",
    "5. Clickbait is fine, lies are not: no invented statistics, fake quotes, fake news, guaranteed income or health claims, and nothing hateful, harassing or sexual.",
    "6. Mention the brand naturally, only where it genuinely fits the topic.",
    "",
    "Return ONLY a JSON object with these keys:",
    '- "hook": the headline/hook line (max 120 characters)',
    '- "body": the full post for Facebook/LinkedIn/Telegram (max 1200 characters, starts with the hook)',
    `- "shortBody": a version for Bluesky/Threads/Mastodon, max 240 characters INCLUDING ${LINK_TOKEN}`,
    '- "engagementComment": a reply/first comment that asks a question to spark discussion and nudges people to the profile or link',
    '- "hashtags": 3 to 5 relevant hashtags without the # sign',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function userPrompt(t: TrendInput) {
  return [`Trending item from ${t.sourceName}:`, `Title: ${t.title}`, t.summary ? `Excerpt: ${t.summary.slice(0, 1200)}` : "", t.url ? `Source URL (do not include it in the post): ${t.url}` : "", "", "Write the post now."]
    .filter((l) => l !== "")
    .join("\n");
}

/** Extract the JSON object from a model reply (tolerates ```json fences and surrounding text). */
export function parseGenerated(text: string): GeneratedPost {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderHttpError("AI reply did not contain a JSON object", null, true);
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ProviderHttpError("AI reply was not valid JSON", null, true);
  }
  const parsed = generatedSchema.safeParse(raw);
  if (!parsed.success) throw new ProviderHttpError(`AI reply was missing fields: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`, null, true);
  const p = parsed.data;
  const withLink = (s: string) => (s.includes(LINK_TOKEN) ? s : `${s}\n\n👉 ${LINK_TOKEN}`);
  return {
    hook: p.hook,
    body: withLink(p.body),
    shortBody: withLink(p.shortBody),
    engagementComment: p.engagementComment,
    hashtags: p.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 5),
  };
}

const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-flash-latest",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  ollama: "llama3.1",
};

async function openAiCompatible(http: HttpClient, url: string, apiKey: string, model: string, system: string, user: string, name: string, jsonMode = true) {
  const res = await http(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(name === "OpenRouter" ? { "X-Title": "LeadOrbit AI" } : {}) },
    body: JSON.stringify({ model, temperature: 0.9, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(jsonMode ? { response_format: { type: "json_object" } } : {}) }),
    timeoutMs: 60_000,
    retries: 1,
  });
  assertOk(res, name);
  const data = parseJson<{ choices?: { message?: { content?: string } }[] }>(res, name);
  return data.choices?.[0]?.message?.content ?? "";
}

/** Run one completion against the selected provider and return the raw text. */
export async function complete(http: HttpClient, providerId: string, conn: Connection, system: string, user: string): Promise<string> {
  const model = conn.settings.model || DEFAULT_MODELS[providerId];
  switch (providerId) {
    case "gemini": {
      const res = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": conn.secrets.apiKey ?? "" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
        }),
        timeoutMs: 60_000,
        retries: 1,
      });
      assertOk(res, "Gemini");
      const data = parseJson<{ candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }>(res, "Gemini");
      if (data.promptFeedback?.blockReason) throw new ProviderHttpError(`Gemini blocked the prompt (${data.promptFeedback.blockReason})`, 400, false);
      return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    }
    case "groq":
      return openAiCompatible(http, "https://api.groq.com/openai/v1/chat/completions", conn.secrets.apiKey ?? "", model, system, user, "Groq");
    case "openrouter":
      return openAiCompatible(http, "https://openrouter.ai/api/v1/chat/completions", conn.secrets.apiKey ?? "", model, system, user, "OpenRouter", false);
    case "ollama": {
      const base = process.env.OLLAMA_URL;
      if (!base) throw new ProviderHttpError("Set the OLLAMA_URL environment variable to use Ollama", 400, false);
      const res = await http(`${base.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false, format: "json", messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        timeoutMs: 180_000,
        retries: 0,
      });
      assertOk(res, "Ollama");
      return parseJson<{ message?: { content?: string } }>(res, "Ollama").message?.content ?? "";
    }
    default:
      throw new ProviderHttpError(`Unknown AI provider ${providerId}`, 400, false);
  }
}

export async function generatePost(http: HttpClient, providerId: string, conn: Connection, brand: Brand, trend: TrendInput): Promise<GeneratedPost> {
  const text = await complete(http, providerId, conn, systemPrompt(brand), userPrompt(trend));
  return parseGenerated(text);
}

export async function testAi(http: HttpClient, providerId: string, conn: Connection) {
  const text = await complete(http, providerId, conn, 'Reply with the JSON object {"ok": true} and nothing else.', "ping");
  if (!text.trim()) return { ok: false, message: "The model returned an empty reply" };
  return { ok: true, message: `Model replied (${conn.settings.model || DEFAULT_MODELS[providerId]})` };
}
