import { z } from 'zod';

/**
 * All environment variables are validated with Zod at startup.
 * The app exits immediately with a descriptive error if any required
 * variable is missing or malformed — no silent failures at runtime.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),

  // Frontend origin for CORS and OAuth redirects
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),

  // PostgreSQL
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // JWT — generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_CALLBACK_URL: z.string().url('GOOGLE_CALLBACK_URL must be a valid URL'),

  // Worker
  WORKER_CONCURRENCY: z.string().default('5'),
  RATE_LIMITER_MAX: z.string().default('1'),
  RATE_LIMITER_DURATION_MS: z.string().default('2000'),

  // Per-sender per-hour email cap
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.string().default('200'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌  Invalid environment variables:\n', JSON.stringify(formatted, null, 2));
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
