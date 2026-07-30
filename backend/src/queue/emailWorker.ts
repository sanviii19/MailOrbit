import { Worker, Job, DelayedError } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env';
import { db } from '../db/client';
import { sendEmail, recordFailure } from '../services/email.service';
import { checkAndIncrement, getNextHourTimestamp } from '../services/rateLimit.service';
import { QUEUE_NAME } from './emailQueue';
import type { DbSender, EmailJobPayload } from '../types';

/**
 * BullMQ Worker — the engine that processes email jobs.
 *
 * IMPORTANT: The worker uses a SEPARATE ioredis connection from the shared
 * singleton.  BullMQ requires `maxRetriesPerRequest: null` on its connections,
 * which would break regular command usage.  Creating a dedicated connection
 * per worker is the documented best practice.
 *
 * Concurrency & Rate Limiting:
 *   - `concurrency`  — N jobs are processed in parallel (env: WORKER_CONCURRENCY)
 *   - `limiter`      — global BullMQ throttle: max M jobs per D ms across ALL
 *                      workers (env: RATE_LIMITER_MAX / RATE_LIMITER_DURATION_MS)
 *   - Redis Lua      — per-sender per-hour cap enforced inside the processor
 *
 * Rate-limit overflow strategy (NO drops):
 *   If the per-sender hourly cap is reached, the job calls job.moveToDelayed()
 *   to reschedule itself at the START of the next UTC hour, then throws
 *   DelayedError so BullMQ knows this is an intentional re-queue, not a failure.
 */

let worker: Worker<EmailJobPayload> | null = null;

export function startWorker(): Worker<EmailJobPayload> {
  // Dedicated ioredis connection for BullMQ worker
  const workerRedis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  worker = new Worker<EmailJobPayload>(
    QUEUE_NAME,
    processor,
    {
      connection: workerRedis,
      concurrency: parseInt(env.WORKER_CONCURRENCY, 10),
      limiter: {
        max: parseInt(env.RATE_LIMITER_MAX, 10),
        duration: parseInt(env.RATE_LIMITER_DURATION_MS, 10),
      },
    },
  );

  // ── Event handlers ──────────────────────────────────────────────────────────

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed for ${job.data.recipientEmail}`);
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    console.error(`[Worker] Job ${job.id} failed:`, err.message);
    // recordFailure updates DB status to 'failed' after BullMQ exhausts retries
    await recordFailure(
      job.data.emailJobId,
      job.data.campaignId,
      err.message,
    ).catch(console.error);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err.message);
  });

  console.log(
    `[Worker] Started | concurrency=${env.WORKER_CONCURRENCY} | ` +
    `limiter=${env.RATE_LIMITER_MAX}/${env.RATE_LIMITER_DURATION_MS}ms | ` +
    `hourly_cap=${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/sender`,
  );

  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

async function processor(
  job: Job<EmailJobPayload>,
  token?: string,
): Promise<void> {
  const payload = job.data;

  // ── 1. Fetch sender credentials ──────────────────────────────────────────
  const sender = await db<DbSender>('senders')
    .where('id', payload.senderId)
    .first();

  if (!sender) {
    // Sender was deleted — fail permanently (no point retrying)
    throw new Error(`Sender ${payload.senderId} not found`);
  }

  // ── 2. Per-sender hourly rate-limit check ────────────────────────────────
  const effectiveLimit =
    payload.hourlyLimit > 0
      ? payload.hourlyLimit
      : parseInt(env.MAX_EMAILS_PER_HOUR_PER_SENDER, 10);

  const allowed = await checkAndIncrement(payload.senderId, effectiveLimit);

  if (!allowed) {
    // Hourly cap reached — reschedule to start of next UTC hour
    const nextHour = getNextHourTimestamp();

    console.warn(
      `[Worker] Rate limit reached for sender ${payload.senderId}. ` +
      `Rescheduling job ${job.id} to ${new Date(nextHour).toISOString()}`,
    );

    // Update DB so dashboard shows 'rate_limited' status
    await db('email_jobs')
      .where('id', payload.emailJobId)
      .update({ status: 'rate_limited' });

    // Move job to the delayed set — BullMQ catches DelayedError and does
    // NOT count this as a failed attempt
    await job.moveToDelayed(nextHour, token);
    throw new DelayedError();
  }

  // ── 3. Send the email ────────────────────────────────────────────────────
  await sendEmail(sender, payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    console.log('[Worker] Closed gracefully');
  }
}
