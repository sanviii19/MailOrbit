import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import { db } from '../db/client';
import { scheduleCampaign } from '../services/scheduler.service';
import { AppError } from '../middleware/error';
import type { DbCampaign, DbSender } from '../types';


// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createCampaignSchema = z.object({
  senderId: z.string().uuid('senderId must be a UUID'),
  // Accept either a pre-parsed array or a comma-separated string
  recipients: z
    .union([
      z.array(z.string().email()),
      z.string().transform((s) =>
        s
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().email()).min(1).max(10_000))
    .optional(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1),
  scheduledStart: z.string().datetime({ message: 'scheduledStart must be an ISO datetime' }),
  delayBetweenEmailsMs: z.coerce.number().int().min(0).default(0),
  hourlyLimit: z.coerce.number().int().min(0).default(0),
  idempotencyKey: z.string().max(255).optional(),
});

const listCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseEmailsFromCsv(buffer: Buffer): string[] {
  try {
    const records = parse(buffer, {
      skip_empty_lines: true,
      trim: true,
    }) as string[][];

    const emails: string[] = [];
    for (const row of records) {
      for (const cell of row) {
        const trimmed = cell.trim().toLowerCase();
        // Basic email validation
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          emails.push(trimmed);
        }
      }
    }
    return [...new Set(emails)]; // deduplicate
  } catch {
    throw new AppError('Failed to parse CSV file', 400);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

export async function createCampaign(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let recipients: string[] = [];
    let attachments: { filename: string; path: string; contentType: string; size: number }[] = [];

    if (req.files && !Array.isArray(req.files)) {
      const csvFiles = req.files['csv'];
      if (csvFiles && csvFiles.length > 0) {
        const csvFile = csvFiles[0];
        recipients = parseEmailsFromCsv(fs.readFileSync(csvFile.path));
        // Delete the temporary CSV file as we only needed the emails
        fs.unlinkSync(csvFile.path);
      }

      const attachmentFiles = req.files['attachments'];
      if (attachmentFiles && attachmentFiles.length > 0) {
        attachments = attachmentFiles.map(f => ({
          filename: f.originalname,
          path: f.path,
          contentType: f.mimetype,
          size: f.size
        }));
      }
    }

    const body = createCampaignSchema.parse(req.body);

    // Merge: combine CSV recipients and manually entered recipients
    if (body.recipients && body.recipients.length > 0) {
      recipients = [...new Set([...recipients, ...body.recipients])];
    }

    if (recipients.length === 0) {
      throw new AppError('No valid recipients found', 400);
    }

    // Idempotency check
    if (body.idempotencyKey) {
      const existing = await db<DbCampaign>('campaigns')
        .where({ idempotency_key: body.idempotencyKey, user_id: req.user!.id })
        .first();
      if (existing) {
        res.status(200).json({
          success: true,
          data: { campaign: existing, message: 'Existing campaign returned (idempotent)' },
        });
        return;
      }
    }

    // Verify sender belongs to this user
    const sender = await db<DbSender>('senders')
      .where({ id: body.senderId, user_id: req.user!.id })
      .first();
    if (!sender) throw new AppError('Sender not found', 404);

    // Create campaign row
    const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
    const [campaign] = await db<DbCampaign>('campaigns')
      .insert({
        idempotency_key: body.idempotencyKey ?? null,
        user_id: req.user!.id,
        sender_id: sender.id,
        subject: body.subject,
        body: body.body,
        scheduled_start: new Date(body.scheduledStart),
        delay_between_emails_ms: body.delayBetweenEmailsMs,
        hourly_limit: body.hourlyLimit,
        total_recipients: recipients.length,
        status: 'pending',
        attachments: attachmentsJson as any,
      })
      .returning('*');

    if (!campaign) throw new AppError('Failed to create campaign', 500);

    // Schedule all jobs asynchronously — don't block the response
    // Using setImmediate to release the current tick and respond first
    setImmediate(() => {
      scheduleCampaign({ campaign, sender, recipients }).catch((err) => {
        console.error(`[Campaign] Scheduling failed for ${campaign.id}:`, err);
      });
    });

    res.status(201).json({
      success: true,
      data: {
        campaign,
        recipientCount: recipients.length,
        message: `${recipients.length} emails are being scheduled`,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listCampaigns(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, limit } = listCampaignsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;

    const [campaigns, [{ count }]] = await Promise.all([
      db<DbCampaign>('campaigns')
        .where('user_id', req.user!.id)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .select(
          'id', 'subject', 'scheduled_start', 'delay_between_emails_ms',
          'hourly_limit', 'total_recipients', 'status', 'created_at',
        ),
      db('campaigns')
        .where('user_id', req.user!.id)
        .count('id as count'),
    ]);

    res.json({
      success: true,
      data: {
        campaigns,
        total: parseInt(String(count), 10),
        page,
        limit,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getCampaign(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;

    const campaign = await db<DbCampaign>('campaigns')
      .where({ id, user_id: req.user!.id })
      .first();

    if (!campaign) throw new AppError('Campaign not found', 404);

    // Fetch job status breakdown
    const stats = await db('email_jobs')
      .where('campaign_id', id)
      .select(
        db.raw("COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled"),
        db.raw("COUNT(*) FILTER (WHERE status = 'rate_limited') as rate_limited"),
        db.raw("COUNT(*) FILTER (WHERE status = 'sent') as sent"),
        db.raw("COUNT(*) FILTER (WHERE status = 'failed') as failed"),
        db.raw("COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled"),
      )
      .first();

    res.json({ success: true, data: { campaign, stats } });
  } catch (err) {
    next(err);
  }
}
