import nodemailer from 'nodemailer';
import type { DbSender } from '../types';

/**
 * Per-sender Nodemailer transport cache.
 * Creating a transport is cheap but avoids repeated object allocation on hot paths.
 */
const transporterCache = new Map<string, nodemailer.Transporter>();

/**
 * Returns a Nodemailer transporter for the given sender.
 * Uses SMTP credentials stored in the senders table.
 * For Ethereal accounts these are always valid (test-only).
 */
export function getTransporter(sender: DbSender): nodemailer.Transporter {
  const cached = transporterCache.get(sender.id);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    secure: sender.smtp_port === 465, // true for port 465, false for 587/25
    auth: {
      user: sender.smtp_user,
      pass: sender.smtp_pass,
    },
    // Soft timeout: fail fast rather than hanging
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });

  transporterCache.set(sender.id, transporter);
  return transporter;
}

/**
 * Creates a new Ethereal test account and returns sender SMTP credentials.
 * Each user-created sender gets its own Ethereal account so rate-limit
 * counters are tracked per-sender independently.
 */
export async function createEtherealAccount(): Promise<{
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}> {
  const account = await nodemailer.createTestAccount();
  return {
    email: account.user,
    smtpHost: account.smtp.host,
    smtpPort: account.smtp.port,
    smtpUser: account.user,
    smtpPass: account.pass,
  };
}

/**
 * Returns the Ethereal preview URL after a successful send.
 * Returns null if the transporter is not an Ethereal transport.
 */
export function getPreviewUrl(info: nodemailer.SentMessageInfo): string | null {
  return nodemailer.getTestMessageUrl(info) || null;
}

/**
 * Invalidate a cached transporter (e.g. after SMTP credential rotation).
 */
export function evictTransporter(senderId: string): void {
  transporterCache.delete(senderId);
}
