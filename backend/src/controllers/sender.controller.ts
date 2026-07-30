import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { createEtherealAccount } from '../smtp/ethereal';
import { AppError } from '../middleware/error';
import type { DbSender } from '../types';

const createSenderSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function listSenders(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const senders = await db<DbSender>('senders')
      .where('user_id', req.user!.id)
      .select('id', 'name', 'email', 'smtp_host', 'smtp_port', 'created_at')
      .orderBy('created_at', 'asc');

    res.json({ success: true, data: { senders } });
  } catch (err) {
    next(err);
  }
}

export async function createSender(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = createSenderSchema.parse(req.body);

    // Provision a new Ethereal test account for this sender
    const ethereal = await createEtherealAccount();

    const [sender] = await db<DbSender>('senders')
      .insert({
        user_id: req.user!.id,
        name: body.name,
        email: ethereal.email,
        smtp_host: ethereal.smtpHost,
        smtp_port: ethereal.smtpPort,
        smtp_user: ethereal.smtpUser,
        smtp_pass: ethereal.smtpPass,
      })
      .returning(['id', 'name', 'email', 'smtp_host', 'smtp_port', 'created_at']);

    res.status(201).json({ success: true, data: { sender } });
  } catch (err) {
    next(err);
  }
}

export async function deleteSender(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;

    const sender = await db<DbSender>('senders')
      .where({ id, user_id: req.user!.id })
      .first();

    if (!sender) throw new AppError('Sender not found', 404);

    // Prevent deleting a sender that has running campaigns
    const runningCount = await db('campaigns')
      .where({ sender_id: id, status: 'running' })
      .count('id as count')
      .first();

    if (runningCount && parseInt(String(runningCount.count), 10) > 0) {
      throw new AppError(
        'Cannot delete sender with active campaigns',
        409,
        'SENDER_IN_USE',
      );
    }

    await db('senders').where({ id, user_id: req.user!.id }).delete();

    res.json({ success: true, data: { message: 'Sender deleted' } });
  } catch (err) {
    next(err);
  }
}
