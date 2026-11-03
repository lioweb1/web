import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { splitPdf } from "@/lib/extract";

describe("splitPdf", () => {
  it("splits into page-numbered chunks that cover every page once", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 65; i++) doc.addPage([200, 200]);
    const { pages, chunks } = await splitPdf(await doc.save(), 30);
    expect(pages).toBe(65);
    expect(chunks.map((c) => [c.firstPage, c.lastPage])).toEqual([[1, 30], [31, 60], [61, 65]]);
    const last = await PDFDocument.load(Buffer.from(chunks[2].base64, "base64"));
    expect(last.getPageCount()).toBe(5);
  });
});
