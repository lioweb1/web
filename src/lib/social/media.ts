import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import sharp from "sharp";
import { schema, systemDb, withTenant } from "@/lib/db";
import { hmacSha256 } from "@/lib/security/crypto";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGES = 10;
/** Bluesky rejects image blobs over ~1 MB, so every image is kept under this. */
const TARGET_BYTES = 950_000;
/** Instagram accepts aspect ratios between 4:5 and 1.91:1; others are padded into range. */
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

export class MediaError extends Error {}

export type ProcessedImage = { data: Buffer; width: number; height: number; mime: "image/jpeg" };

/**
 * Normalise an upload for every platform: honour EXIF rotation, cap at 2048 px, pad into
 * Instagram's aspect range, flatten transparency on white, and encode as JPEG under ~950 KB.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new MediaError("This file is not a supported image");
  }
  if (!meta.width || !meta.height) throw new MediaError("Could not read the image size");
  let img = sharp(input, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: "#ffffff" }).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  const { data: base, info } = await img.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  let w = info.width;
  let h = info.height;
  img = sharp(base);
  const ratio = w / h;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
    const tw = ratio < MIN_RATIO ? Math.ceil(h * MIN_RATIO) : w;
    const th = ratio > MAX_RATIO ? Math.ceil(w / MAX_RATIO) : h;
    const left = Math.floor((tw - w) / 2);
    const top = Math.floor((th - h) / 2);
    img = img.extend({ left, right: tw - w - left, top, bottom: th - h - top, background: "#ffffff" });
    w = tw;
    h = th;
  }
  const padded = await img.jpeg({ quality: 92 }).toBuffer();
  for (const [quality, maxSide] of [
    [85, 2048],
    [78, 2048],
    [72, 1600],
    [65, 1280],
    [58, 1080],
  ] as const) {
    const r = await sharp(padded).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (r.data.length <= TARGET_BYTES || maxSide === 1080) return { data: r.data, width: r.info.width, height: r.info.height, mime: "image/jpeg" };
  }
  throw new MediaError("Could not compress the image");
}

function key() {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k) throw new Error("APP_ENCRYPTION_KEY is not set");
  return k;
}

export function mediaSignature(id: string) {
  return hmacSha256(key(), `social-media:${id}`).slice(0, 32);
}

export function verifyMediaSignature(id: string, sig: string) {
  const expected = Buffer.from(mediaSignature(id));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Signed URL platforms fetch the image from (absolute) or the app previews it with (relative). */
export function mediaUrl(id: string, opts: { absolute?: boolean } = {}) {
  const path = `/api/social/media/${id}.jpg?sig=${mediaSignature(id)}`;
  return opts.absolute ? `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}` : path;
}

export async function saveUpload(workspaceId: string, file: { bytes: Buffer; type: string; name?: string }) {
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new MediaError("Images can be up to 15 MB");
  if (!/^image\/(jpeg|png|webp|gif|heic|heif|avif|tiff)$/i.test(file.type)) throw new MediaError("Upload a JPEG, PNG, WebP, GIF, HEIC or AVIF image");
  const img = await processImage(file.bytes);
  const [row] = await withTenant(workspaceId, (tx) =>
    tx.insert(schema.socialMedia).values({ workspaceId, mime: img.mime, data: img.data, width: img.width, height: img.height, size: img.data.length }).returning({ id: schema.socialMedia.id, width: schema.socialMedia.width, height: schema.socialMedia.height, size: schema.socialMedia.size }),
  );
  return { ...row, url: mediaUrl(row.id) };
}

export type MediaInfo = { id: string; width: number; height: number; altText: string | null };

/** Attach uploaded images to a post (keeps the given order) and store their alt texts. */
export async function attachMedia(workspaceId: string, postId: string, ids: string[], alts: string[] = []) {
  if (!ids.length) return [] as MediaInfo[];
  if (ids.length > MAX_IMAGES) throw new MediaError(`Up to ${MAX_IMAGES} images per post`);
  return withTenant(workspaceId, async (tx) => {
    const rows = await tx.select({ id: schema.socialMedia.id, postId: schema.socialMedia.postId }).from(schema.socialMedia).where(and(eq(schema.socialMedia.workspaceId, workspaceId), inArray(schema.socialMedia.id, ids)));
    if (rows.length !== new Set(ids).size || rows.some((r) => r.postId && r.postId !== postId)) throw new MediaError("An image was not found or belongs to another post. Upload it again.");
    for (const [i, id] of ids.entries()) await tx.update(schema.socialMedia).set({ postId, altText: alts[i]?.trim() || null }).where(eq(schema.socialMedia.id, id));
    await tx.update(schema.socialPosts).set({ mediaIds: ids }).where(eq(schema.socialPosts.id, postId));
    const info = await tx.select({ id: schema.socialMedia.id, width: schema.socialMedia.width, height: schema.socialMedia.height, altText: schema.socialMedia.altText }).from(schema.socialMedia).where(inArray(schema.socialMedia.id, ids));
    return ids.map((id) => info.find((x) => x.id === id)!);
  });
}

export async function mediaInfo(workspaceId: string, ids: string[]): Promise<MediaInfo[]> {
  if (!ids.length) return [];
  const rows = await withTenant(workspaceId, (tx) => tx.select({ id: schema.socialMedia.id, width: schema.socialMedia.width, height: schema.socialMedia.height, altText: schema.socialMedia.altText }).from(schema.socialMedia).where(inArray(schema.socialMedia.id, ids)));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is MediaInfo => !!r);
}

export async function mediaBytes(workspaceId: string, id: string) {
  const [row] = await withTenant(workspaceId, (tx) => tx.select({ data: schema.socialMedia.data, mime: schema.socialMedia.mime }).from(schema.socialMedia).where(eq(schema.socialMedia.id, id)));
  if (!row) throw new MediaError("Image not found");
  return row;
}

/** Delete uploads that never got attached to a post. */
export async function cleanupOrphanMedia(olderThanHours = 24) {
  const res = await systemDb()
    .delete(schema.socialMedia)
    .where(and(isNull(schema.socialMedia.postId), lt(schema.socialMedia.createdAt, new Date(Date.now() - olderThanHours * 3600_000))))
    .returning({ id: schema.socialMedia.id });
  return res.length;
}
