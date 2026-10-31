import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function outboxMessages() {
  const directory = process.env.MAIL_OUTBOX_DIR;
  if (!directory) throw new Error('Tests require an isolated MAIL_OUTBOX_DIR');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.eml')).map(filename => {
    const raw = readFileSync(path.join(directory, filename), 'utf8');
    const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/=\r?\n/g, '')
      .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    return { filename, raw, body };
  });
}
export function resetLink(body: string): URL {
  const link = body.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) throw new Error('Reset email did not contain a link');
  return new URL(link);
}
export function tokenFromEmail(body: string): string {
  const token = new URLSearchParams(resetLink(body).hash.slice(1)).get('token');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Reset email token is missing');
  return token;
}
