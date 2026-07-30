import { Router } from 'express';
import { db } from '../db/client';
import { redis } from '../redis/client';
import { emailQueue } from '../queue/emailQueue';
import { env } from '../config/env';
import os from 'os';

const router = Router();

/**
 * GET /health
 * Quick liveness check — no DB/Redis call.
 * Used by Render's health checker and UptimeRobot.
 */
router.get('/', (_req, res) => {
  res.json({
    status: 'ok, Good to Go..!!',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * GET /health/deep
 * Full readiness check — verifies DB, Redis, and queue.
 * Returns 200 if all OK, 503 if any check fails.
 */
router.get('/deep', async (_req, res) => {
  const startTime = Date.now();
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; detail?: string }> = {};

  // ── 1. PostgreSQL ──────────────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    await db.raw('SELECT 1');
    checks['postgres'] = { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (err) {
    checks['postgres'] = {
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 2. Redis ───────────────────────────────────────────────────────────────
  try {
    const t0 = Date.now();
    await redis.ping();
    checks['redis'] = { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (err) {
    checks['redis'] = {
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 3. BullMQ Queue counts ─────────────────────────────────────────────────
  try {
    const [waiting, active, delayed, failed, completed] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
      emailQueue.getDelayedCount(),
      emailQueue.getFailedCount(),
      emailQueue.getCompletedCount(),
    ]);
    checks['queue'] = {
      status: 'ok',
      detail: JSON.stringify({ waiting, active, delayed, failed, completed }),
    };
  } catch (err) {
    checks['queue'] = {
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 4. Process info ────────────────────────────────────────────────────────
  const memMb = process.memoryUsage();
  const processInfo = {
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: {
      rss: (memMb.rss / 1024 / 1024).toFixed(1),
      heapUsed: (memMb.heapUsed / 1024 / 1024).toFixed(1),
      heapTotal: (memMb.heapTotal / 1024 / 1024).toFixed(1),
    },
    cpus: os.cpus().length,
    nodeVersion: process.version,
  };

  // ── Overall status ─────────────────────────────────────────────────────────
  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  const httpStatus = allOk ? 200 : 503;

  res.status(httpStatus).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    totalLatencyMs: Date.now() - startTime,
    checks,
    process: processInfo,
  });
});

export default router;
