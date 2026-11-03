import { eq } from "drizzle-orm";
import { schema, systemDb } from "@/lib/db";
import { verifyCardSignature } from "@/lib/social/image";
import { renderCardJpeg } from "@/lib/social/card";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyCardSignature(id, sig)) return new Response("Not found", { status: 404 });
  const [post] = await systemDb().select().from(schema.socialPosts).where(eq(schema.socialPosts.id, id));
  if (!post) return new Response("Not found", { status: 404 });
  const [ap] = await systemDb().select({ config: schema.socialAutopilots.config }).from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, post.workspaceId));
  const jpeg = await renderCardJpeg({ hook: post.hook, brand: ap?.config.brandName ?? "", keyword: post.primaryKeyword || post.hashtags[0] || "", brandColor: ap?.config.brandColor });
  return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
}
