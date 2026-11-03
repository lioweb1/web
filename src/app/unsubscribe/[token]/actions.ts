"use server";
import { redirect } from "next/navigation";
import { unsubscribeByToken } from "@/lib/services/outreach";

/** Public: no session. The opaque token in the email link is the only credential. */
export async function unsubscribeAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const res = await unsubscribeByToken(token);
  redirect(res.ok ? `/unsubscribe/${encodeURIComponent(token)}?done=1` : `/unsubscribe/${encodeURIComponent(token)}`);
}
