import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, systemDb } from "@/lib/db";
import { cardPalette, hookFontSize, verifyCardSignature } from "@/lib/social/image";

export const dynamic = "force-dynamic";

const fontCache = new Map<string, ArrayBuffer | null>();

/** Bengali glyphs are not in the default font; load Noto Sans Bengali from Google Fonts once. */
async function bengaliFont(): Promise<ArrayBuffer | null> {
  if (fontCache.has("bn")) return fontCache.get("bn")!;
  let data: ArrayBuffer | null = null;
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@700", { signal: AbortSignal.timeout(8000) })).text();
    const url = css.match(/src:\s*url\(([^)]+\.(?:ttf|otf))\)/)?.[1];
    if (url) data = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).arrayBuffer();
  } catch {}
  fontCache.set("bn", data);
  return data;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyCardSignature(id, sig)) return new Response("Not found", { status: 404 });
  const [post] = await systemDb().select().from(schema.socialPosts).where(eq(schema.socialPosts.id, id));
  if (!post) return new Response("Not found", { status: 404 });
  const [ap] = await systemDb().select({ config: schema.socialAutopilots.config }).from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, post.workspaceId));
  const brand = ap?.config.brandName ?? "";
  const { from, to } = cardPalette(ap?.config.brandColor);
  const keyword = post.primaryKeyword || post.hashtags[0] || "";
  const text = `${post.hook} ${brand} ${keyword}`;
  const bn = /[ঀ-৿]/.test(text) ? await bengaliFont() : null;

  // Emoji are fetched from a CDN at render time; if that fails, render the card without them.
  const render = (strip: boolean) => {
    const t = (v: string) => (strip ? v.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim() : v);
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`, color: "white", ...(bn ? { fontFamily: "NotoBengali" } : {}) }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {brand ? <div style={{ display: "flex", fontSize: 34, fontWeight: 700, padding: "12px 28px", borderRadius: 999, background: "rgba(255,255,255,0.18)" }}>{t(brand)}</div> : <div style={{ display: "flex" }} />}
          </div>
          <div style={{ display: "flex", fontSize: hookFontSize(post.hook), fontWeight: 800, lineHeight: 1.12, letterSpacing: -1 }}>{t(post.hook)}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 34 }}>
            {keyword ? <div style={{ display: "flex", padding: "10px 24px", borderRadius: 14, background: "rgba(0,0,0,0.25)" }}>#{t(keyword).replace(/\s+/g, "")}</div> : <div style={{ display: "flex" }} />}
            <div style={{ display: "flex", fontWeight: 700 }}>Read more →</div>
          </div>
        </div>
      ),
      { width: 1080, height: 1080, ...(bn ? { fonts: [{ name: "NotoBengali", data: bn, weight: 700 as const, style: "normal" as const }] } : {}) },
    ).arrayBuffer();
  };
  let png: ArrayBuffer;
  try {
    png = await render(false);
  } catch {
    png = await render(true);
  }
  // Instagram only accepts JPEG.
  const jpeg = await sharp(Buffer.from(png)).jpeg({ quality: 88 }).toBuffer();
  return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
}
