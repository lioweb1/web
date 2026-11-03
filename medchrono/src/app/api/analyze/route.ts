import { extractChunk, hasApiKey, splitPdf, ExtractionRefused, type PdfChunk } from "@/lib/extract";
import { mergeChunks, type ChunkResult } from "@/lib/merge";

export const runtime = "nodejs";
export const maxDuration = 800;

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const CONCURRENCY = 3;

export type AnalyzeEvent =
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "warning"; message: string }
  | { type: "result"; extraction: ReturnType<typeof mergeChunks> }
  | { type: "error"; message: string };

/**
 * POST multipart/form-data { case_name, files[] (PDF) }.
 * Streams newline-delimited JSON events. Nothing is written to disk or a database:
 * files live in memory for the duration of the request only.
 */
export async function POST(req: Request) {
  if (!hasApiKey()) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured on the server. Try the demo case, or add a key to .env." }, { status: 503 });
  }
  const form = await req.formData();
  const caseName = String(form.get("case_name") || "Untitled case").slice(0, 120);
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return Response.json({ error: "Upload at least one PDF." }, { status: 400 });
  for (const f of uploads) {
    if (f.size > MAX_FILE_BYTES) return Response.json({ error: `${f.name} is larger than 200 MB.` }, { status: 413 });
    if (f.type && f.type !== "application/pdf") return Response.json({ error: `${f.name} is not a PDF.` }, { status: 415 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AnalyzeEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const warnings: string[] = [];
      try {
        const files: { name: string; pages: number }[] = [];
        const jobs: { file: string; chunk: PdfChunk }[] = [];
        for (const f of uploads) {
          try {
            const { pages, chunks } = await splitPdf(new Uint8Array(await f.arrayBuffer()));
            files.push({ name: f.name, pages });
            for (const chunk of chunks) jobs.push({ file: f.name, chunk });
          } catch {
            const msg = `${f.name}: could not read this PDF (damaged or password-protected). Skipped.`;
            warnings.push(msg);
            send({ type: "warning", message: msg });
          }
        }
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
            } catch (err) {
              if (req.signal.aborted) throw err;
              const msg = `${label}: ${err instanceof ExtractionRefused || err instanceof Error ? err.message : "failed"} — review these pages manually.`;
              warnings.push(msg);
              send({ type: "warning", message: msg });
            }
            send({ type: "progress", done: ++done, total: jobs.length, label });
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
        results.sort((a, b) => a.file.localeCompare(b.file) || a.firstPage - b.firstPage);
        send({ type: "result", extraction: mergeChunks(caseName, files, results, warnings) });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Analysis failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
