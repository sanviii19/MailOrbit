import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { emailQueue } from '../queue/emailQueue';
import { AppError } from '../middleware/error';
import type { DbEmailJob } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const listEmailsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  campaignId: z.string().uuid().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the base query for email_jobs that belong to the current user.
 * Joins through campaigns to enforce user ownership.
 */
function userEmailJobsQuery(userId: string) {
  return db<DbEmailJob>('email_jobs')
    .join('campaigns', 'email_jobs.campaign_id', 'campaigns.id')
    .where('campaigns.user_id', userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/emails/scheduled — jobs awaiting send (scheduled + rate_limited) */
export async function listScheduled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit, search, campaignId } = listEmailsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;

    let query = userEmailJobsQuery(req.user!.id)
      .whereIn('email_jobs.status', ['scheduled', 'rate_limited'])
      .select(
        'email_jobs.id',
        'email_jobs.campaign_id',
        'email_jobs.sender_id',
        'email_jobs.recipient_email',
        'email_jobs.subject',
        'email_jobs.body',
        'email_jobs.scheduled_at',
        'email_jobs.status',
        'email_jobs.starred',
        'email_jobs.attempts',
        'email_jobs.created_at',
      )
      .orderBy('email_jobs.scheduled_at', 'asc');

    let countQuery = userEmailJobsQuery(req.user!.id)
      .whereIn('email_jobs.status', ['scheduled', 'rate_limited']);

    if (search) {
      const like = `%${search}%`;
      query = query.where((b) =>
        b
          .whereILike('email_jobs.recipient_email', like)
          .orWhereILike('email_jobs.subject', like),
      );
      countQuery = countQuery.where((b) =>
        b
          .whereILike('email_jobs.recipient_email', like)
          .orWhereILike('email_jobs.subject', like),
      );
    }

    if (campaignId) {
      query = query.where('email_jobs.campaign_id', campaignId);
      countQuery = countQuery.where('email_jobs.campaign_id', campaignId);
    }

    const [emails, [{ count }]] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery.count('email_jobs.id as count'),
    ]);

    res.json({
      success: true,
      data: { emails, total: parseInt(String(count), 10), page, limit },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/emails/sent — delivered and failed jobs */
export async function listSent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit, search, campaignId } = listEmailsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;

    let query = userEmailJobsQuery(req.user!.id)
      .whereIn('email_jobs.status', ['sent', 'failed'])
      .select(
        'email_jobs.id',
        'email_jobs.campaign_id',
        'email_jobs.sender_id',
        'email_jobs.recipient_email',
        'email_jobs.subject',
        'email_jobs.body',
        'email_jobs.scheduled_at',
        'email_jobs.sent_at',
        'email_jobs.status',
        'email_jobs.starred',
        'email_jobs.attempts',
        'email_jobs.error_message',
        'email_jobs.created_at',
      )
      .orderBy('email_jobs.sent_at', 'desc');

    let countQuery = userEmailJobsQuery(req.user!.id)
      .whereIn('email_jobs.status', ['sent', 'failed']);

    if (search) {
      const like = `%${search}%`;
      query = query.where((b) =>
        b
          .whereILike('email_jobs.recipient_email', like)
          .orWhereILike('email_jobs.subject', like),
      );
      countQuery = countQuery.where((b) =>
        b
          .whereILike('email_jobs.recipient_email', like)
          .orWhereILike('email_jobs.subject', like),
      );
    }

    if (campaignId) {
      query = query.where('email_jobs.campaign_id', campaignId);
      countQuery = countQuery.where('email_jobs.campaign_id', campaignId);
    }

    const [emails, [{ count }]] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery.count('email_jobs.id as count'),
    ]);

    res.json({
      success: true,
      data: { emails, total: parseInt(String(count), 10), page, limit },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/emails/:id — full email detail */
export async function getEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;

    const email = await userEmailJobsQuery(req.user!.id)
      .where('email_jobs.id', id)
      .select(
        'email_jobs.*',
        'campaigns.subject as campaign_subject',
        'campaigns.total_recipients',
        'campaigns.status as campaign_status',
        'campaigns.attachments as campaign_attachments'
      )
      .first();

    if (!email) throw new AppError('Email not found', 404);

    // Fetch sender info (name + email only, no SMTP credentials)
    const sender = await db('senders')
      .where('id', email.sender_id)
      .select('id', 'name', 'email')
      .first();

    res.json({ success: true, data: { email: { ...email, sender } } });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/emails/:id/star — toggle starred flag */
export async function toggleStar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;

    const email = await userEmailJobsQuery(req.user!.id)
      .where('email_jobs.id', id)
      .select('email_jobs.id', 'email_jobs.starred')
      .first();

    if (!email) throw new AppError('Email not found', 404);

    const [updated] = await db('email_jobs')
      .where('id', id)
      .update({ starred: !email.starred })
      .returning(['id', 'starred']);

    res.json({ success: true, data: { id: updated.id, starred: updated.starred } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/emails/:id — cancel a scheduled job or delete from view */
export async function cancelOrDelete(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;

    const email = await userEmailJobsQuery(req.user!.id)
      .where('email_jobs.id', id)
      .select('email_jobs.id', 'email_jobs.status')
      .first();

    if (!email) throw new AppError('Email not found', 404);

    if (email.status === 'scheduled' || email.status === 'rate_limited') {
      // Remove from BullMQ — the job will NOT fire
      const job = await emailQueue.getJob(id);
      if (job) await job.remove();

      // Mark cancelled in DB
      await db('email_jobs').where('id', id).update({ status: 'cancelled' });

      res.json({ success: true, data: { message: 'Email job cancelled' } });
    } else {
      // Already sent/failed — just soft-delete by marking cancelled
      await db('email_jobs').where('id', id).update({ status: 'cancelled' });
      res.json({ success: true, data: { message: 'Email removed from view' } });
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/emails/stats — aggregate counts for the dashboard */
export async function getStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await userEmailJobsQuery(req.user!.id)
      .select(
        db.raw("COUNT(*) FILTER (WHERE email_jobs.status = 'scheduled') as scheduled"),
        db.raw("COUNT(*) FILTER (WHERE email_jobs.status = 'rate_limited') as rate_limited"),
        db.raw("COUNT(*) FILTER (WHERE email_jobs.status = 'sent') as sent"),
        db.raw("COUNT(*) FILTER (WHERE email_jobs.status = 'failed') as failed"),
        db.raw("COUNT(*) FILTER (WHERE email_jobs.status = 'cancelled') as cancelled"),
      )
      .first();

    res.json({ success: true, data: { stats } });
  } catch (err) {
    next(err);
  }
}
