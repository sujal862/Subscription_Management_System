import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { emailSchema } from '../../../shared/auth.js';
import { config } from './config.js';

export interface MailMessage { to: string; subject: string; text: string; html?: string }
export class MailDeliveryError extends Error {
  constructor() { super('Email delivery could not be completed'); }
}

// Narrow inputs intentionally exclude Nodemailer's raw/path/URL attachment options.
// Used by reset now; invoice owners can reuse it for sending stored invoices later.
export async function sendMail(message: MailMessage): Promise<void> {
  const to = emailSchema.parse(message.to);
  const from = process.env.MAIL_FROM ?? 'Brightloop <demo@brightloop.local>';
  if (/[\r\n]/.test(message.subject) || /[\r\n]/.test(from)) throw new MailDeliveryError();
  const content = {
    from, to: { name: '', address: to }, subject: message.subject, text: message.text,
    ...(message.html === undefined ? {} : { html: message.html }),
    disableFileAccess: true, disableUrlAccess: true, textEncoding: 'quoted-printable' as const,
  };
  try {
    if ((process.env.MAIL_MODE ?? 'file') === 'file') {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      const result = await transport.sendMail(content);
      const directory = path.resolve(process.env.MAIL_OUTBOX_DIR ?? '.local/outbox');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, `${randomUUID()}.eml`), result.message, { flag: 'wx', mode: 0o600 });
      return;
    }
    if (process.env.MAIL_MODE !== 'smtp') throw new MailDeliveryError();
    const port = Number(process.env.SMTP_PORT ?? 587);
    if (!process.env.SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535) throw new MailDeliveryError();
    const secure = process.env.SMTP_SECURE === 'true';
    const requireTLS = config.production || process.env.SMTP_REQUIRE_TLS === 'true';
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure, requireTLS: !secure && requireTLS,
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } } : {}),
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail(content);
      if (!result.accepted?.length || result.rejected?.length) throw new MailDeliveryError();
    } finally { transport.close(); }
  } catch {
    // Do not leak SMTP errors: a server can echo message content, including links.
    throw new MailDeliveryError();
  }
}
