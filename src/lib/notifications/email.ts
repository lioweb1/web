import nodemailer, { type Transporter } from "nodemailer";

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

let transport: Transporter | null = null;
export type OutboxMessage = { to: string; subject: string; text: string; html?: string; headers?: Record<string, string>; from?: string };
let testOutbox: OutboxMessage[] | null = null;

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

export type SmtpSettings = { host: string; port: number; user?: string; password?: string; from: string; replyTo?: string };

/** Server-wide SMTP settings from the environment, if configured. */
export function envSmtp(): SmtpSettings | null {
  if (!smtpConfigured()) return null;
  return {
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    from: process.env.SMTP_FROM!,
  };
}

function transportFor(cfg: SmtpSettings) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

/** Log in to an SMTP server without sending anything (connection test). */
export async function verifySmtp(cfg: SmtpSettings) {
  if (testOutbox) return;
  const t = transportFor(cfg);
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

/**
 * Send one message over a specific SMTP account (used for outreach, where each
 * workspace brings its own account). Returns the server's Message-ID when available.
 */
export async function sendEmailVia(cfg: SmtpSettings, msg: { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> }): Promise<{ messageId: string | null }> {
  if (testOutbox) {
    testOutbox.push({ ...msg, from: cfg.from });
    return { messageId: `<test-${testOutbox.length}@localhost>` };
  }
  const t = transportFor(cfg);
  try {
    const info = await t.sendMail({ from: cfg.from, replyTo: cfg.replyTo, ...msg });
    return { messageId: info.messageId ?? null };
  } finally {
    t.close();
  }
}

export function appUrl(path = "") {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}
