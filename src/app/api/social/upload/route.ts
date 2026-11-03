import { NextResponse } from "next/server";
import { getAuth, hasRole } from "@/lib/auth/session";
import { rateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { MAX_UPLOAD_BYTES, MediaError, saveUpload } from "@/lib/social/media";

export const dynamic = "force-dynamic";

/** Composer image upload (one file per request, field "file"). */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  if (!hasRole(ctx, "member")) return NextResponse.json({ error: "Viewers cannot upload images." }, { status: 403 });
  try {
    await rateLimit(`social-upload:${ctx.workspace.id}`, 120, 3600);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file received" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Images can be up to 15 MB" }, { status: 413 });
    const saved = await saveUpload(ctx.workspace.id, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name });
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof MediaError || e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[social upload]", e);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
