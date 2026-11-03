import { extractChunk, hasApiKey, splitPdf, ExtractionRefused, type PdfChunk } from "@/lib/extract";
import { mergeChunks, type ChunkResult } from "@/lib/merge";
import { requestUser, sameOrigin } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { CreditError, finishReservation, refundReservation, reserveCredits } from "@/lib/credits";

export const runtime = "nodejs";
export const maxDuration = 800;

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 50;
const CONCURRENCY = 3;

export type AnalyzeEvent =
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "warning"; message: string }
  | { type: "billing"; credits: number; trial: boolean; pages: number }
  | { type: "result"; extraction: ReturnType<typeof mergeChunks> }
  | { type: "error"; message: string };

const err = (error: string, status: number, code?: string) => Response.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST multipart/form-data { case_name, files[] (PDF) }.
 * Requires a signed-in user with enough credits. Streams newline-delimited JSON events.
 * Nothing about the records is written to disk or the database — only the page count for billing.
 */
export async function POST(req: Request) {
  if (!hasApiKey()) return err("ANTHROPIC_API_KEY is not configured on the server.", 503);
  if (!dbConfigured()) return err("DATABASE_URL is not configured on the server.", 503);
  if (!sameOrigin(req)) return err("Cross-site request blocked.", 403);
  const user = await requestUser(req);
  if (!user) return err("Please sign in.", 401);

  const form = await req.formData();
  const caseName = String(form.get("case_name") || "Untitled case").slice(0, 120);
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return err("Upload at least one PDF.", 400);
  if (uploads.length > MAX_FILES) return err(`Upload at most ${MAX_FILES} files per case.`, 400);
  for (const f of uploads) {
    if (f.size > MAX_FILE_BYTES) return err(`${f.name} is larger than 200 MB.`, 413);
    if (f.type && f.type !== "application/pdf") return err(`${f.name} is not a PDF.`, 415);
  }

  // Split first: the page count decides the price, and unreadable files shouldn't cost anything.
  const warnings: string[] = [];
  const files: { name: string; pages: number }[] = [];
  const jobs: { file: string; chunk: PdfChunk }[] = [];
  for (const f of uploads) {
    try {
      const { pages, chunks } = await splitPdf(new Uint8Array(await f.arrayBuffer()));
      files.push({ name: f.name, pages });
      for (const chunk of chunks) jobs.push({ file: f.name, chunk });
    } catch {
      warnings.push(`${f.name}: could not read this PDF (damaged or password-protected). Skipped.`);
    }
  }
  const totalPages = files.reduce((s, f) => s + f.pages, 0);
  if (jobs.length === 0) return err(warnings.join(" ") || "No readable pages.", 422);

  let reservation;
  try {
    reservation = await reserveCredits(user.org.id, user.id, totalPages, files.length);
  } catch (e) {
    if (e instanceof CreditError) return err(e.message, e.status, e.code);
    throw e;
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AnalyzeEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      let settled = false;
      try {
        send({ type: "billing", credits: reservation.spend.credits, trial: reservation.spend.trial > 0, pages: totalPages });
        for (const w of warnings) send({ type: "warning", message: w });
        const results: ChunkResult[] = [];
        let done = 0;
        send({ type: "progress", done, total: jobs.length, label: "Reading records" });
        let next = 0;
        const worker = async () => {
          while (next < jobs.length) {
            const job = jobs[next++];
            const label = `${job.file} · pages ${job.chunk.firstPage}–${job.chunk.lastPage}`;
            try {
              const data = await extractChunk(job.chunk, job.file, req.signal);
              results.push({ file: job.file, firstPage: job.chunk.firstPage, lastPage: job.chunk.lastPage, data });
            } catch (e) {
              if (req.signal.aborted) throw e;
              const msg = `${label}: ${e instanceof ExtractionRefused || e instanceof Error ? e.message : "failed"} — review these pages manually.`;
              warnings.push(msg);
              send({ type: "warning", message: msg });
            }
            send({ type: "progress", done: ++done, total: jobs.length, label });
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
        if (results.length === 0) {
          await refundReservation(reservation.eventId, "No pages could be analyzed");
          settled = true;
          send({ type: "error", message: "None of the pages could be analyzed. Your credit has been refunded." });
          return;
        }
        results.sort((a, b) => a.file.localeCompare(b.file) || a.firstPage - b.firstPage);
        await finishReservation(reservation.eventId);
        settled = true;
        send({ type: "result", extraction: mergeChunks(caseName, files, results, warnings) });
      } catch (e) {
        if (!settled) {
          await refundReservation(reservation.eventId, req.signal.aborted ? "Cancelled by user" : "Processing error").catch(() => {});
          settled = true;
        }
        send({ type: "error", message: req.signal.aborted ? "Cancelled. Your credit has been refunded." : `${e instanceof Error ? e.message : "Analysis failed"}. Your credit has been refunded.` });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
