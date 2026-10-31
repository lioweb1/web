import { timingSafeEqual } from "node:crypto";
import { hmacSha256 } from "@/lib/security/crypto";

/**
 * Branded image cards are served from a public URL so Facebook/Instagram/Threads can fetch them.
 * The URL carries an HMAC of the post id, so nobody can enumerate other workspaces' posts.
 */
function key() {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k) throw new Error("APP_ENCRYPTION_KEY is not set");
  return k;
}

export function cardSignature(postId: string) {
  return hmacSha256(key(), `social-card:${postId}`).slice(0, 32);
}

export function verifyCardSignature(postId: string, sig: string) {
  const expected = Buffer.from(cardSignature(postId));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Absolute URL (for platforms) or relative (for in-app previews). `v` busts caches after edits. */
export function cardImageUrl(postId: string, opts: { absolute?: boolean; version?: Date | null } = {}) {
  const path = `/api/social/image/${postId}?sig=${cardSignature(postId)}${opts.version ? `&v=${opts.version.getTime()}` : ""}`;
  return opts.absolute ? `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}` : path;
}

/** Card colours derived from the brand colour (falls back to indigo). */
export function cardPalette(brandColor: string | null | undefined) {
  const hex = /^#?[0-9a-f]{6}$/i.test(brandColor ?? "") ? `#${brandColor!.replace("#", "")}` : "#4f46e5";
  const n = parseInt(hex.slice(1), 16);
  const dark = (c: number) => Math.round(c * 0.45);
  const darker = `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => dark(c).toString(16).padStart(2, "0")).join("")}`;
  return { from: hex, to: darker };
}

export function hookFontSize(hook: string) {
  const l = Array.from(hook).length;
  return l <= 40 ? 92 : l <= 70 ? 76 : l <= 100 ? 64 : 54;
}
