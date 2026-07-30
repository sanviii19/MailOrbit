import { Queue } from 'bullmq';
import { redis } from '../redis/client';
import type { EmailJobPayload } from '../types';

export const QUEUE_NAME = 'email-queue';

/**
 * BullMQ Queue — the single point through which all email jobs are added.
 *
 * The queue is backed by Redis.  Jobs survive server restarts because Redis
 * persists them (AOF is enabled in docker-compose.yml).
 *
 * Global rate limiter (RATE_LIMITER_MAX jobs per RATE_LIMITER_DURATION_MS):
 *   Controls the MINIMUM GAP between any two email sends across all workers.
 *   The default (1 job / 2000ms) mimics a provider throttle of 30 emails/min.
 *
 * These values come from environment variables — no hardcoding.
 */
export const emailQueue = new Queue<EmailJobPayload>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    // Keep completed jobs for 24 h so the dashboard can display history
    removeOnComplete: { age: 86_400, count: 10_000 },
    // Never auto-remove failed jobs — we surface them in the dashboard
    removeOnFail: false,
  },
});

emailQueue.on('error', (err) => {
  console.error('[Queue] Error:', err.message);
});
