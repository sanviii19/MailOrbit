import 'dotenv/config'; // Must be first — loads .env before env.ts validation runs
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import passport from './auth/passport';
import { env } from './config/env';
import { db } from './db/client';
import { redis } from './redis/client';
import { emailQueue } from './queue/emailQueue';
import { startWorker, closeWorker } from './queue/emailWorker';

// Routes
import authRoutes from './routes/auth.routes';
import senderRoutes from './routes/sender.routes';
import campaignRoutes from './routes/campaign.routes';
import emailRoutes from './routes/email.routes';
import path from 'path';

// Error handler (must import after routes)
import { errorHandler } from './middleware/error';

// ─────────────────────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS — only allow the configured frontend origin
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true, // needed for httpOnly refresh cookie
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// HTTP request logging
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser (for httpOnly refresh token)
app.use(cookieParser());

// Passport (OAuth only — no sessions)
app.use(passport.initialize());

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/senders', senderRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/emails', emailRoutes);

// Static uploads directory for attachments
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found' } });
});

// Global error handler — must be last middleware
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function start() {
  // Verify DB connectivity
  await db.raw('SELECT 1');
  console.log('[DB] PostgreSQL connected');

  // Verify Redis connectivity
  await redis.ping();
  console.log('[Redis] Redis connected');

  // Start BullMQ worker (in-process for simplicity — can be separated later)
  startWorker();

  // Start HTTP server
  const port = parseInt(env.PORT, 10);
  const server = app.listen(port, () => {
    console.log(`[Server] Listening on http://localhost:${port}`);
    console.log(`[Server] Environment: ${env.NODE_ENV}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

    // 1. Stop accepting new HTTP connections
    server.close(() => console.log('[Server] HTTP server closed'));

    // 2. Drain the worker (finish current jobs)
    await closeWorker();

    // 3. Close queue
    await emailQueue.close();
    console.log('[Queue] Closed');

    // 4. Close DB pool
    await db.destroy();
    console.log('[DB] Connection pool closed');

    // 5. Close Redis
    await redis.quit();
    console.log('[Redis] Connection closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Catch unhandled promise rejections (log, don't crash)
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled rejection:', reason);
  });
}

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});

export default app;
