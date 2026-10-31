import { z } from "zod";
import { assertOk, parseJson, ProviderHttpError, type HttpClient } from "@/lib/providers/http";
import type { SocialAutopilotConfig } from "@/lib/db/schema";
import type { Connection } from "./accounts";

/** Placeholder the model writes where the link goes; replaced per platform when publishing. */
export const LINK_TOKEN = "{LINK}";

export type TrendInput = { title: string; summary?: string | null; url?: string | null; sourceName: string };

export type GeneratedPost = {
  primaryKeyword: string;
  /** Best-scoring hook first. */
  hooks: string[];
  /** Post text WITHOUT the hook (the hook is prepended when publishing). */
  body: string;
  shortBody: string;
  platformTexts: { linkedin?: string; instagram?: string };
  thread: string[];
  engagementComment: string;
  hashtags: string[];
  altText: string;
};

const generatedSchema = z.object({
  primaryKeyword: z.string().trim().max(80).default(""),
  hooks: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  body: z.string().trim().min(1).max(3000),
  shortBody: z.string().trim().min(1).max(600),
  linkedin: z.string().trim().max(3000).optional(),
  instagram: z.string().trim().max(2200).optional(),
  thread: z.array(z.string().trim().max(500)).max(5).default([]),
  engagementComment: z.string().trim().max(1000).default(""),
  hashtags: z.array(z.string()).max(12).default([]),
  altText: z.string().trim().max(500).default(""),
});

type Brand = Pick<SocialAutopilotConfig, "brandName" | "brandVoice" | "language" | "keywords" | "link">;

export function systemPrompt(brand: Brand, opts: { winningHooks?: string[] } = {}) {
  return [
    "You are an elite viral copywriter and social SEO specialist for the brand below. Your posts stop the scroll, get clicks and rank in platform search.",
    `Brand: ${brand.brandName || "(unnamed)"}`,
    brand.brandVoice ? `About the brand / voice: ${brand.brandVoice}` : "",
    brand.keywords.length ? `Niche keywords: ${brand.keywords.join(", ")}` : "",
    `Write in ${brand.language || "English"}.`,
    "",
    "HOOKS (the most important part):",
    "- Write 3 very different hooks, max 100 characters each, using proven formulas: curiosity gap (\"Nobody talks about this…\"), contrarian/negativity (\"Stop doing X\"), specific number/list (\"3 signs your…\"), FOMO/urgency (\"Before everyone else finds out…\"), bold promise, open question, \"I tried X so you don't have to\".",
    "- Use power words (secret, mistake, finally, actually, nobody, instantly, proven), 1 emoji max, and speak to \"you\".",
    "- Open a loop the reader can only close by reading on or clicking.",
    "",
    "SEO:",
    "- Choose one primaryKeyword people actually search for in this niche; put it naturally in at least one hook and in the first sentence of every text.",
    "- Use 1-2 related secondary keywords naturally. No keyword stuffing.",
    "- Hashtags: 6-8, mixing 2 broad high-volume tags, 3 niche tags and 1-2 long-tail tags. No # sign. No spaces.",
    "- altText: a descriptive image alt text containing the primaryKeyword.",
    "",
    "STYLE:",
    "- Casual, punchy, emotional. Short lines, line breaks, a few well-placed emojis. Pattern: hook → tension → payoff tease → call to action.",
    `- End every text with a call to action using the literal token ${LINK_TOKEN} exactly once (e.g. "Full breakdown 👉 ${LINK_TOKEN}").`,
    "- Texts must NOT repeat the hook; the hook is placed above them automatically.",
    "",
    "HARD RULES:",
    "- The source item is only inspiration for the TOPIC. Write completely original text: never copy its sentences, never quote or name its author, never pretend to be them.",
    "- Clickbait is fine, lies are not: no invented statistics or quotes, no fake news, no guaranteed income or health claims, nothing hateful, harassing or sexual. The post must deliver on what the hook promises.",
    "- Mention the brand only where it genuinely fits.",
    opts.winningHooks?.length ? `\nHooks that performed best with this audience (learn the style, do not copy): ${opts.winningHooks.map((h) => `"${h}"`).join("; ")}` : "",
    "",
    "Return ONLY a JSON object with these keys:",
    '- "primaryKeyword": string',
    '- "hooks": array of 3 strings',
    '- "body": Facebook/Telegram text, max 900 characters',
    '- "linkedin": professional, insight-led version for LinkedIn, max 1200 characters, fewer emojis',
    '- "instagram": emoji-rich caption for Instagram, max 900 characters, short paragraphs',
    `- "shortBody": max 170 characters INCLUDING ${LINK_TOKEN}, for Bluesky/Threads/Mastodon`,
    '- "thread": 2 to 4 follow-up posts (max 260 characters each) that deliver the payoff, the last one ending with the CTA',
    '- "engagementComment": a first comment that asks a question to spark replies and nudges people to the profile or link',
    '- "hashtags": array of strings',
    '- "altText": string',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function userPrompt(t: TrendInput) {
  return [`Trending item from ${t.sourceName}:`, `Title: ${t.title}`, t.summary ? `Excerpt: ${t.summary.slice(0, 1200)}` : "", t.url ? `Source URL (do not include it in the post): ${t.url}` : "", "", "Write the post now."]
    .filter((l) => l !== "")
    .join("\n");
}

const POWER = ["secret", "mistake", "nobody", "never", "stop", "finally", "actually", "truth", "instantly", "proven", "why", "how", "before", "hidden", "warning", "everyone", "this"];

/**
 * Heuristic 0–100 hook strength: length sweet spot, numbers, power words, curiosity punctuation,
 * direct address and the SEO keyword. Used to rank variants, not as a promise of reach.
 */
export function hookScore(hook: string, keywords: string[] = []) {
  const h = hook.trim();
  const lower = h.toLowerCase();
  const len = Array.from(h).length;
  let s = 20;
  if (len >= 30 && len <= 90) s += 20;
  else if (len < 120) s += 8;
  else s -= 10;
  if (/\d/.test(h)) s += 12;
  s += Math.min(18, POWER.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)).length * 9);
  if (/[?…]|\.\.\./.test(h)) s += 8;
  if (/\byou(r)?\b/.test(lower)) s += 10;
  if (/\p{Extended_Pictographic}/u.test(h)) s += 4;
  if (keywords.some((k) => k && lower.includes(k.toLowerCase()))) s += 10;
  if (h === h.toUpperCase() && /[A-Z]{6,}/.test(h)) s -= 15;
  return Math.max(0, Math.min(100, s));
}

/** Extract the JSON object from a model reply (tolerates ```json fences and surrounding text). */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderHttpError("AI reply did not contain a JSON object", null, true);
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ProviderHttpError("AI reply was not valid JSON", null, true);
  }
}

export function parseGenerated(text: string, keywords: string[] = []): GeneratedPost {
  const raw = extractJson(text) as Record<string, unknown>;
  // Older/smaller models sometimes return a single "hook".
  if (!raw.hooks && typeof raw.hook === "string") raw.hooks = [raw.hook];
  const parsed = generatedSchema.safeParse(raw);
  if (!parsed.success) throw new ProviderHttpError(`AI reply was missing fields: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`, null, true);
  const p = parsed.data;
  const withLink = (s: string) => (s.includes(LINK_TOKEN) ? s : `${s}\n\n👉 ${LINK_TOKEN}`);
  const kw = [p.primaryKeyword, ...keywords].filter(Boolean);
  const hooks = [...new Set(p.hooks)].sort((a, b) => hookScore(b, kw) - hookScore(a, kw));
  const stripHook = (s: string) => hooks.reduce((acc, h) => (acc.startsWith(h) ? acc.slice(h.length).trim() : acc), s.trim());
  const platformTexts: GeneratedPost["platformTexts"] = {};
  if (p.linkedin) platformTexts.linkedin = withLink(stripHook(p.linkedin));
  if (p.instagram) platformTexts.instagram = withLink(stripHook(p.instagram));
  return {
    primaryKeyword: p.primaryKeyword,
    hooks,
    body: withLink(stripHook(p.body)),
    shortBody: withLink(stripHook(p.shortBody)),
    platformTexts,
    thread: p.thread.filter(Boolean).slice(0, 4),
    engagementComment: p.engagementComment,
    hashtags: [...new Set(p.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean))].slice(0, 8),
    altText: p.altText,
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

export async function generatePost(http: HttpClient, providerId: string, conn: Connection, brand: Brand, trend: TrendInput, opts: { winningHooks?: string[] } = {}): Promise<GeneratedPost> {
  const text = await complete(http, providerId, conn, systemPrompt(brand, opts), userPrompt(trend));
  return parseGenerated(text, brand.keywords);
}

export function replySystemPrompt(brand: Brand) {
  return [
    `You reply to comments on social posts for the brand "${brand.brandName || "our brand"}".`,
    brand.brandVoice ? `About the brand: ${brand.brandVoice}` : "",
    "Write like a friendly human, never like a bot: short (max 220 characters), warm, specific to what they said.",
    "Answer their point or question, add one bit of value, and when it fits naturally invite them to check the profile or link. Never paste the link yourself.",
    "Reply in the same language as the comment.",
    "If the comment is spam, abusive, a scam, or needs a human (complaint, legal, refund), set skip to true.",
    'Return ONLY JSON: {"reply": string, "skip": boolean}',
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateReply(http: HttpClient, providerId: string, conn: Connection, brand: Brand, ctx: { postHook: string; postText: string; comment: string; author?: string | null }) {
  const user = `Our post: ${ctx.postHook}\n${ctx.postText.slice(0, 800)}\n\nComment${ctx.author ? ` from ${ctx.author}` : ""}: ${ctx.comment.slice(0, 1000)}\n\nWrite the reply.`;
  const raw = extractJson(await complete(http, providerId, conn, replySystemPrompt(brand), user)) as { reply?: unknown; skip?: unknown };
  const reply = typeof raw.reply === "string" ? raw.reply.trim().slice(0, 500) : "";
  return { reply, skip: raw.skip === true || !reply };
}

export async function testAi(http: HttpClient, providerId: string, conn: Connection) {
  const text = await complete(http, providerId, conn, 'Reply with the JSON object {"ok": true} and nothing else.', "ping");
  if (!text.trim()) return { ok: false, message: "The model returned an empty reply" };
  return { ok: true, message: `Model replied (${conn.settings.model || DEFAULT_MODELS[providerId]})` };
}
