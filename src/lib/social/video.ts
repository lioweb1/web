import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, withTenant } from "@/lib/db";
import { mediaBytes } from "./media";
import { renderCardJpeg, renderVideoOverlay } from "./card";

const run = promisify(execFile);
const W = 1080;
const H = 1920;
const FPS = 30;

export class VideoError extends Error {}

/** FFMPEG_PATH, else the bundled @ffmpeg-installer binary, else `ffmpeg` on PATH. */
export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return (createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg") as { path: string }).path;
  } catch {
    return "ffmpeg";
  }
}

/** One 1080×1920 frame: blurred, darkened fill + the whole image centred + optional text overlay. */
export async function makeSlide(image: Buffer, overlay: Buffer | null) {
  const bg = await sharp(image).resize(W, H, { fit: "cover" }).blur(40).modulate({ brightness: 0.55 }).toBuffer();
  const fg = await sharp(image).resize(W - 60, H - 520, { fit: "inside", withoutEnlargement: false }).toBuffer();
  const layers: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [{ input: fg, gravity: "center" }];
  if (overlay) layers.push({ input: overlay, top: 0, left: 0 });
  return sharp(bg).composite(layers).jpeg({ quality: 90 }).toBuffer();
}

/** ffmpeg arguments: slow zoom on each slide, fade between slides, silent stereo audio, H.264 MP4. */
export function slideshowArgs(slides: string[], seconds: number, out: string) {
  const frames = Math.round(seconds * FPS);
  const fade = Math.min(0.4, seconds / 4);
  const inputs = slides.flatMap((s) => ["-i", s]);
  const parts = slides.map(
    (_, i) =>
      `[${i}:v]scale=${W * 1.5}:${H * 1.5},zoompan=z='min(zoom+0.0007,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},` +
      `fade=t=in:st=0:d=${fade},fade=t=out:st=${(seconds - fade).toFixed(2)}:d=${fade},setsar=1,format=yuv420p[v${i}]`,
  );
  const concat = `${slides.map((_, i) => `[v${i}]`).join("")}concat=n=${slides.length}:v=1:a=0[v]`;
  const total = (seconds * slides.length).toFixed(2);
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-f",
    "lavfi",
    "-t",
    total,
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex",
    [...parts, concat].join(";"),
    "-map",
    "[v]",
    "-map",
    `${slides.length}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "24",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ];
}

/**
 * Build the vertical slideshow MP4 from images: the first slide carries the hook, the last one
 * the call to action. 1 image → 6 s, otherwise `secondsPerSlide` each (max 20 slides / 60 s).
 */
export async function buildSlideshow(images: Buffer[], o: { hook: string; cta: string; brand: string; brandColor: string | null | undefined; secondsPerSlide?: number }) {
  if (!images.length) throw new VideoError("No images for the video");
  const list = images.slice(0, 20);
  const seconds = list.length === 1 ? 6 : Math.max(1.5, Math.min(10, o.secondsPerSlide ?? 3, 60 / list.length));
  const dir = await mkdtemp(path.join(tmpdir(), "leadorbit-video-"));
  try {
    const [first, last] = await Promise.all([
      renderVideoOverlay({ top: o.hook, bottom: list.length === 1 ? o.cta : undefined, brand: o.brand, brandColor: o.brandColor }),
      list.length > 1 ? renderVideoOverlay({ bottom: o.cta, brand: o.brand, brandColor: o.brandColor }) : Promise.resolve(null),
    ]);
    const files: string[] = [];
    for (const [i, img] of list.entries()) {
      const overlay = i === 0 ? first : i === list.length - 1 ? last : null;
      const f = path.join(dir, `slide${i}.jpg`);
      await writeFile(f, await makeSlide(img, overlay));
      files.push(f);
    }
    const out = path.join(dir, "out.mp4");
    try {
      await run(ffmpegPath(), slideshowArgs(files, seconds, out), { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
      throw new VideoError(`Video rendering failed: ${(e as { stderr?: string }).stderr?.slice(0, 300) || (e instanceof Error ? e.message : String(e))}`);
    }
    return { data: await readFile(out), seconds: seconds * list.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type PostRow = typeof schema.socialPosts.$inferSelect;

/** Reuse the post's video, or render and store a new one from its uploads (or its branded card). */
export async function ensureVideo(workspaceId: string, post: PostRow, cfg: { brandName: string; brandColor: string; videoSecondsPerSlide?: number }, link: string) {
  if (post.videoId) {
    const [row] = await withTenant(workspaceId, (tx) => tx.select({ id: schema.socialMedia.id, size: schema.socialMedia.size }).from(schema.socialMedia).where(eq(schema.socialMedia.id, post.videoId!)));
    if (row) return row;
  }
  const images = post.mediaIds.length
    ? await Promise.all(post.mediaIds.map(async (id) => (await mediaBytes(workspaceId, id)).data))
    : [await renderCardJpeg({ hook: post.hook, brand: cfg.brandName, keyword: post.primaryKeyword || post.hashtags[0] || "", brandColor: cfg.brandColor })];
  const video = await buildSlideshow(images, { hook: post.hook, cta: link ? "Link in bio 👆" : "Follow for more 👆", brand: cfg.brandName, brandColor: cfg.brandColor, secondsPerSlide: cfg.videoSecondsPerSlide });
  return withTenant(workspaceId, async (tx) => {
    const [row] = await tx.insert(schema.socialMedia).values({ workspaceId, postId: post.id, mime: "video/mp4", data: video.data, width: W, height: H, size: video.data.length }).returning({ id: schema.socialMedia.id, size: schema.socialMedia.size });
    await tx.update(schema.socialPosts).set({ videoId: row.id }).where(eq(schema.socialPosts.id, post.id));
    return row;
  });
}
