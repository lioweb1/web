import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PDFDocument } from "pdf-lib";
import { ChunkExtractionSchema, type ChunkExtraction } from "./schema";

export const MODEL = process.env.MEDCHRONO_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.MEDCHRONO_EFFORT || "high") as "low" | "medium" | "high" | "xhigh" | "max";
export const PAGES_PER_CHUNK = Math.max(5, Number(process.env.MEDCHRONO_PAGES_PER_CHUNK) || 30);

const SYSTEM = `You are a senior legal nurse consultant who prepares medical chronologies for personal-injury, workers' compensation and medical-malpractice cases.

You receive an excerpt of a medical record PDF. Extract every clinical encounter, every billed charge, every record the text refers to, and every pre-existing condition, exactly as documented.

Rules:
- Only state what the record says. Never infer a diagnosis, date or amount that is not written. If unsure, leave the field empty or null.
- Page numbers refer to pages of THIS attachment, starting at 1.
- One encounter per date of service per provider. If one visit spans several pages, give the page range.
- Billing ledgers, UB-04 and CMS-1500 forms, and itemized statements go in "bills", one row per line item.
- "referenced_records": any visit, test, imaging study, referral, prior treatment or provider that is mentioned (e.g. "MRI at Valley Imaging on 3/2 showed…", "referred to Dr. Lee", "seen by her chiropractor last year"). The matching against what is actually present happens later, so list them all.
- "prior_conditions": prior injuries, prior treatment or chronic conditions involving the same body parts or symptoms, with a short verbatim quote.
- Dates as YYYY-MM-DD. Keep quotes verbatim and short.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type PdfChunk = { index: number; firstPage: number; lastPage: number; base64: string };

/** Split a PDF into chunks of N pages so each request stays small and page citations stay exact. */
export async function splitPdf(bytes: Uint8Array, pagesPerChunk = PAGES_PER_CHUNK): Promise<{ pages: number; chunks: PdfChunk[] }> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = src.getPageCount();
  const chunks: PdfChunk[] = [];
  for (let start = 0, index = 0; start < pages; start += pagesPerChunk, index++) {
    const end = Math.min(start + pagesPerChunk, pages);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i));
    copied.forEach((p) => out.addPage(p));
    const data = await out.save();
    chunks.push({ index, firstPage: start + 1, lastPage: end, base64: Buffer.from(data).toString("base64") });
  }
  return { pages, chunks };
}

export class ExtractionRefused extends Error {}

/** Send one chunk to Claude and get back schema-validated JSON. */
export async function extractChunk(chunk: PdfChunk, fileName: string, signal?: AbortSignal): Promise<ChunkExtraction> {
  const stream = getClient().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT, format: betaZodOutputFormat(ChunkExtractionSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: chunk.base64 } },
            {
              type: "text",
              text: `File: "${fileName}". This attachment is pages ${chunk.firstPage}–${chunk.lastPage} of the original file. Report page numbers relative to this attachment (1 = page ${chunk.firstPage}). Extract everything per the rules.`,
            },
          ],
        },
      ],
    },
    { signal },
  );
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new ExtractionRefused(`The model declined pages ${chunk.firstPage}–${chunk.lastPage}.`);
  if (msg.stop_reason === "max_tokens") throw new Error(`Output truncated for pages ${chunk.firstPage}–${chunk.lastPage}; lower MEDCHRONO_PAGES_PER_CHUNK.`);
  if (!msg.parsed_output) throw new Error(`Could not parse extraction for pages ${chunk.firstPage}–${chunk.lastPage}.`);
  return msg.parsed_output;
}
