import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transport: Transporter | null = null;

export function emailConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("EMAIL_FROM"));
}

function getTransport(): Transporter {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: env("SMTP_USER") ? { user: env("SMTP_USER"), pass: env("SMTP_PASSWORD") } : undefined,
  });
  return transport;
}

export type Mail = { to: string; subject: string; text: string; html?: string };

/** Outbox used by tests and by local development when SMTP isn't configured. */
export const devOutbox: Mail[] = [];

/** Sends an email via SMTP (works with AWS SES SMTP). Without SMTP it logs the email so links can be copied in development. */
export async function sendEmail(m: Mail): Promise<void> {
  if (!emailConfigured()) {
    devOutbox.push(m);
    if (devOutbox.length > 50) devOutbox.shift();
    if (process.env.NODE_ENV === "production") {
      console.warn(`[email] SMTP not configured — email to ${m.to} ("${m.subject}") was NOT sent.`);
    } else {
      console.info(`\n[email:dev] To: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`);
    }
    return;
  }
  await getTransport().sendMail({ from: process.env.EMAIL_FROM, ...m });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A plain, client-safe transactional email layout with one button. */
export function buttonEmail(opts: { heading: string; intro: string; button: string; url: string; footer: string }): { text: string; html: string } {
  const text = `${opts.heading}\n\n${opts.intro}\n\n${opts.button}: ${opts.url}\n\n${opts.footer}\n\n— MedChrono AI`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:Arial,Helvetica,sans-serif;color:#0f1f33">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #dfe4ea;border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:bold;color:#1e3a5f">MedChrono AI</td></tr>
<tr><td style="padding-top:18px;font-size:20px;font-weight:bold">${esc(opts.heading)}</td></tr>
<tr><td style="padding-top:10px;font-size:15px;line-height:1.5;color:#3d4b5c">${esc(opts.intro)}</td></tr>
<tr><td style="padding:24px 0"><a href="${esc(opts.url)}" style="background:#0e8f86;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esc(opts.button)}</a></td></tr>
<tr><td style="font-size:12px;color:#5b6b7d;line-height:1.5">${esc(opts.footer)}<br><br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${esc(opts.url)}</span></td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
