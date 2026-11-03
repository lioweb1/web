import { hasApiKey, MODEL } from "@/lib/extract";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ live: hasApiKey(), model: hasApiKey() ? MODEL : null });
}
