import { eq } from "drizzle-orm";
import { schema, systemDb } from "@/lib/db";
import { verifyMediaSignature } from "@/lib/social/media";

export const dynamic = "force-dynamic";

/** Public, signed image URL so Facebook/Instagram/Threads/Telegram/Discord can fetch uploads. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.jpe?g$/i, "");
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyMediaSignature(id, sig)) return new Response("Not found", { status: 404 });
  const [row] = await systemDb().select({ data: schema.socialMedia.data, mime: schema.socialMedia.mime }).from(schema.socialMedia).where(eq(schema.socialMedia.id, id));
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.mime, "Content-Length": String(row.data.length), "Cache-Control": "public, max-age=31536000, immutable" } });
}
