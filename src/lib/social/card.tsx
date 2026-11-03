import { ImageResponse } from "next/og";
import sharp from "sharp";
import { cardPalette, hookFontSize } from "./image";

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

const stripEmoji = (v: string) => v.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim();

/**
 * Render JSX to PNG. Emoji are fetched from a CDN at render time; if that fails, render again
 * without them so a card is always produced.
 */
async function renderPng(build: (t: (v: string) => string, font: string | undefined) => React.ReactElement, width: number, height: number, text: string) {
  const bn = /[ঀ-৿]/.test(text) ? await bengaliFont() : null;
  const opts = { width, height, ...(bn ? { fonts: [{ name: "NotoBengali", data: bn, weight: 700 as const, style: "normal" as const }] } : {}) };
  const font = bn ? "NotoBengali" : undefined;
  try {
    return Buffer.from(await new ImageResponse(build((v) => v, font), opts).arrayBuffer());
  } catch {
    return Buffer.from(await new ImageResponse(build(stripEmoji, font), opts).arrayBuffer());
  }
}

export type CardInput = { hook: string; brand: string; keyword: string; brandColor: string | null | undefined };

/** The branded 1080×1080 card used when a post has no image. Returns JPEG (Instagram needs it). */
export async function renderCardJpeg(c: CardInput) {
  const { from, to } = cardPalette(c.brandColor);
  const png = await renderPng(
    (t, font) => (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`, color: "white", ...(font ? { fontFamily: font } : {}) }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {c.brand ? <div style={{ display: "flex", fontSize: 34, fontWeight: 700, padding: "12px 28px", borderRadius: 999, background: "rgba(255,255,255,0.18)" }}>{t(c.brand)}</div> : <div style={{ display: "flex" }} />}
        </div>
        <div style={{ display: "flex", fontSize: hookFontSize(c.hook), fontWeight: 800, lineHeight: 1.12, letterSpacing: -1 }}>{t(c.hook)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 34 }}>
          {c.keyword ? <div style={{ display: "flex", padding: "10px 24px", borderRadius: 14, background: "rgba(0,0,0,0.25)" }}>#{t(c.keyword).replace(/\s+/g, "")}</div> : <div style={{ display: "flex" }} />}
          <div style={{ display: "flex", fontWeight: 700 }}>Read more →</div>
        </div>
      </div>
    ),
    1080,
    1080,
    `${c.hook} ${c.brand} ${c.keyword}`,
  );
  return sharp(png).jpeg({ quality: 88 }).toBuffer();
}

/** Transparent 1080×1920 text overlay for video slides: hook on top, call to action at the bottom. */
export async function renderVideoOverlay(o: { top?: string; bottom?: string; brand?: string; brandColor: string | null | undefined }) {
  const { from } = cardPalette(o.brandColor);
  return renderPng(
    (t, font) => (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "140px 60px 220px", color: "white", ...(font ? { fontFamily: font } : {}) }}>
        {o.top ? (
          <div style={{ display: "flex", fontSize: hookFontSize(o.top) * 0.85, fontWeight: 800, lineHeight: 1.15, padding: "28px 36px", borderRadius: 28, background: "rgba(0,0,0,0.55)" }}>{t(o.top)}</div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          {o.bottom ? <div style={{ display: "flex", fontSize: 54, fontWeight: 800, padding: "20px 40px", borderRadius: 999, background: from }}>{t(o.bottom)}</div> : null}
          {o.brand ? <div style={{ display: "flex", fontSize: 34, fontWeight: 700, padding: "8px 24px", borderRadius: 999, background: "rgba(0,0,0,0.45)" }}>{t(o.brand)}</div> : null}
        </div>
      </div>
    ),
    1080,
    1920,
    `${o.top ?? ""} ${o.bottom ?? ""} ${o.brand ?? ""}`,
  );
}
