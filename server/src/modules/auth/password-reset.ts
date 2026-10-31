import { createHash, randomBytes } from 'node:crypto';
import { db } from '../../lib/db.js';
import { config } from '../../lib/config.js';
import { HttpError } from '../../lib/http.js';
import { hashPassword } from '../../lib/password.js';
import { sendMail } from '../../lib/mail.js';

export const RESET_DURATION_MS = 30 * 60 * 1000;
export const RESET_RESEND_INTERVAL_MS = 60 * 1000;
export const RESET_REQUEST_MESSAGE = 'If an active account exists for that email, a password reset link will be sent.';
export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');
const deliveries = new Set<Promise<void>>();

// Also usable by graceful shutdown/tests. SMTP does not delay the public response
// differently for existing accounts, and errors never escape as unhandled promises.
export async function waitForPasswordResetDeliveries() { await Promise.all([...deliveries]); }

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user?.isActive) return;
  const recent = await db.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_RESEND_INTERVAL_MS) } },
  });
  if (recent) return;
  const token = randomBytes(32).toString('hex');
  const link = new URL('/account/reset-password', config.appUrl);
  if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password || (config.production && link.protocol !== 'https:')) {
    throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Password recovery is temporarily unavailable');
  }
  link.hash = `token=${token}`;
  const [, record] = await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_DURATION_MS) } }),
  ]);
  const delivery = (async () => {
    try {
      await sendMail({ to: user.email, subject: 'Reset your Brightloop password', text:
        `A password reset was requested for your Brightloop account.\n\nOpen this link:\n${link.href}\n\nThis link expires in 30 minutes and can be used once.\nIf you did not request this, you can ignore this email.\n` });
    } catch {
      await db.passwordResetToken.deleteMany({ where: { id: record.id } });
      console.error('Password reset email delivery failed. Check the configured mail service.');
    }
  })().catch(() => { console.error('Password reset delivery cleanup failed.'); }).finally(() => { deliveries.delete(delivery); });
  deliveries.add(delivery);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashResetToken(token);
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
  const invalid = () => new HttpError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or expired. Request a new link.');
  if (!record || record.expiresAt <= new Date() || !record.user.isActive) throw invalid();
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    // Atomic compare-and-delete: concurrent requests cannot consume a token twice.
    const consumed = await tx.passwordResetToken.deleteMany({ where: {
      id: record.id, tokenHash, expiresAt: { gt: new Date() }, user: { isActive: true },
    } });
    if (consumed.count !== 1) throw invalid();
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: record.userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId } });
  });
}
