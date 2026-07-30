import { Queue } from 'bullmq';
import { v5 as uuidv5 } from 'uuid';
import { db } from '../db/client';
import { emailQueue } from '../queue/emailQueue';
import type { DbCampaign, DbSender, EmailJobPayload } from '../types';

/**
 * UUID v5 namespace for deterministic job IDs.
 * Using a fixed namespace ensures the same (campaignId + recipientEmail)
 * always produces the same UUID — BullMQ silently ignores duplicate jobIds,
 * giving us idempotency at the queue layer for free.
 */
const JOB_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // URL namespace

/**
 * Generates a deterministic BullMQ jobId for a (campaign, recipient) pair.
 * Also used as the DB primary key for email_jobs.
 */
export function makeJobId(campaignId: string, recipientEmail: string): string {
  return uuidv5(`${campaignId}:${recipientEmail}`, JOB_ID_NAMESPACE);
}

export interface ScheduleCampaignInput {
  campaign: DbCampaign;
  sender: DbSender;
  recipients: string[];
}

/**
 * Schedules all emails for a campaign as BullMQ delayed jobs.
 *
 * Algorithm:
 *   delay[i] = max(0, scheduledStart - now) + i * delayBetweenEmailsMs
 *
 * Each email job fires exactly once when its delay expires.
 * On server restart, BullMQ reads the delay timestamps from Redis
 * and fires jobs at the correct time — no recalculation needed.
 *
 * Duplicate protection:
 *   - DB: UNIQUE(campaign_id, recipient_email) — DB insert is idempotent
 *   - BullMQ: same jobId → add() is silently ignored
 *
 * Bulk-insert DB rows then bulk-enqueue BullMQ jobs for efficiency.
 */
export async function scheduleCampaign({
  campaign,
  sender,
  recipients,
}: ScheduleCampaignInput): Promise<void> {
  const now = Date.now();
  const scheduledStart = new Date(campaign.scheduled_start).getTime();
  const baseDelay = Math.max(0, scheduledStart - now);

  // Build all DB rows first (one INSERT ... ON CONFLICT DO NOTHING batch)
  const jobRows: Array<{
    id: string;
    campaign_id: string;
    sender_id: string;
    recipient_email: string;
    subject: string;
    body: string;
    scheduled_at: Date;
    status: string;
  }> = [];

  const bullJobs: Array<{ jobId: string; payload: EmailJobPayload; delay: number }> = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipientEmail = recipients[i]!.toLowerCase().trim();
    const jobId = makeJobId(campaign.id, recipientEmail);
    const delay = baseDelay + i * campaign.delay_between_emails_ms;
    const scheduledAt = new Date(now + delay);

    jobRows.push({
      id: jobId,
      campaign_id: campaign.id,
      sender_id: sender.id,
      recipient_email: recipientEmail,
      subject: campaign.subject,
      body: campaign.body,
      scheduled_at: scheduledAt,
      status: 'scheduled',
    });

    bullJobs.push({
      jobId,
      delay,
      payload: {
        emailJobId: jobId,
        campaignId: campaign.id,
        senderId: sender.id,
        recipientEmail,
        subject: campaign.subject,
        body: campaign.body,
        scheduledAt: scheduledAt.toISOString(),
        hourlyLimit: campaign.hourly_limit,
        attachments: campaign.attachments ? (typeof campaign.attachments === 'string' ? JSON.parse(campaign.attachments) : campaign.attachments) : undefined,
      },
    });
  }

  // Batch DB insert — ON CONFLICT DO NOTHING for idempotency
  // Knex chunk prevents hitting Postgres param limit (~65k)
  const CHUNK_SIZE = 500;
  for (let i = 0; i < jobRows.length; i += CHUNK_SIZE) {
    await db('email_jobs')
      .insert(jobRows.slice(i, i + CHUNK_SIZE))
      .onConflict('id')
      .ignore();
  }

  // Bulk-enqueue BullMQ jobs — addBulk is transactional within BullMQ
  // Jobs with duplicate jobIds are silently ignored by BullMQ
  const BULL_CHUNK = 1000;
  for (let i = 0; i < bullJobs.length; i += BULL_CHUNK) {
    const chunk = bullJobs.slice(i, i + BULL_CHUNK);
    await (emailQueue as Queue<EmailJobPayload>).addBulk(
      chunk.map(({ jobId, payload, delay }) => ({
        name: 'send-email',
        data: payload,
        opts: {
          jobId,
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 86_400 }, // keep completed jobs 24h for audit
          removeOnFail: false,               // keep failed jobs indefinitely
        },
      })),
    );
  }

  console.log(
    `[Scheduler] Enqueued ${recipients.length} jobs for campaign ${campaign.id}`,
  );
}
