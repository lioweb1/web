import nodemailer, { type Transporter } from "nodemailer";

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

let transport: Transporter | null = null;
let testOutbox: { to: string; subject: string; text: string }[] | null = null;

/** Tests capture outgoing mail instead of sending it. */
export function captureEmailsForTests(on: boolean) {
  testOutbox = on ? [] : null;
  return testOutbox;
}

export function emailDeliveryAvailable() {
  return smtpConfigured() || testOutbox !== null;
}

export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string }) {
  if (testOutbox) {
    testOutbox.push(msg);
    return;
  }
  if (!smtpConfigured()) throw new Error("SMTP is not configured (set SMTP_HOST and SMTP_FROM).");
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM, ...msg });
}

export function appUrl(path = "") {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}
