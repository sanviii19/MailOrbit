import { db } from '../db/client';
import { getTransporter, getPreviewUrl } from '../smtp/ethereal';
import type { DbSender, EmailJobPayload } from '../types';

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

/**
 * Sends a single email via the sender's SMTP transport.
 * Updates the email_jobs row on success or failure.
 *
 * @throws Error if SMTP send fails (BullMQ will retry up to maxAttempts)
 */
export async function sendEmail(
  sender: DbSender,
  payload: EmailJobPayload,
): Promise<SendResult> {
  const transporter = getTransporter(sender);

  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: payload.recipientEmail,
    subject: payload.subject,
    html: payload.body,
    attachments: payload.attachments?.map((a) => ({
      filename: a.filename,
      path: a.path,
      contentType: a.contentType,
    })),
  });

  const previewUrl = getPreviewUrl(info);

  if (previewUrl) {
    console.log(
      `[SMTP] Email sent to ${payload.recipientEmail} | Preview: ${previewUrl}`,
    );
  } else {
    console.log(
      `[SMTP] Email sent to ${payload.recipientEmail} | messageId: ${info.messageId}`,
    );
  }

  // Update DB — mark as sent
  await db('email_jobs').where('id', payload.emailJobId).update({
    status: 'sent',
    sent_at: db.fn.now(),
    attempts: db.raw('attempts + 1'),
    error_message: null,
  });

  // Update campaign status to 'running' on first send, 'completed' when all done
  await updateCampaignProgress(payload.campaignId);

  return { messageId: info.messageId as string, previewUrl };
}

/**
 * Records a failed send attempt in the DB.
 * Called by the worker's onFailed handler after all BullMQ retries are exhausted.
 */
export async function recordFailure(
  emailJobId: string,
  campaignId: string,
  errorMessage: string,
): Promise<void> {
  await db('email_jobs').where('id', emailJobId).update({
    status: 'failed',
    error_message: errorMessage.slice(0, 2000), // guard against huge stack traces
    attempts: db.raw('attempts + 1'),
  });

  await updateCampaignProgress(campaignId);
}

/**
 * Transitions campaign status based on completed job counts.
 *   pending → running  (first job done)
 *   running → completed (all jobs done)
 *   running → failed    (all jobs done, some failed)
 */
async function updateCampaignProgress(campaignId: string): Promise<void> {
  const campaign = await db('campaigns').where('id', campaignId).first();
  if (!campaign) return;

  const counts = await db('email_jobs')
    .where('campaign_id', campaignId)
    .select(
      db.raw("COUNT(*) FILTER (WHERE status = 'sent') as sent_count"),
      db.raw("COUNT(*) FILTER (WHERE status = 'failed') as failed_count"),
      db.raw(
        "COUNT(*) FILTER (WHERE status IN ('scheduled','rate_limited')) as pending_count",
      ),
    )
    .first();

  if (!counts) return;

  const sent = parseInt(counts.sent_count, 10);
  const failed = parseInt(counts.failed_count, 10);
  const pending = parseInt(counts.pending_count, 10);

  let newStatus: string | null = null;

  if (campaign.status === 'pending' && (sent > 0 || failed > 0)) {
    newStatus = 'running';
  }

  if (pending === 0) {
    newStatus = failed > 0 && sent === 0 ? 'failed' : 'completed';
  }

  if (newStatus) {
    await db('campaigns').where('id', campaignId).update({ status: newStatus });
  }
}
