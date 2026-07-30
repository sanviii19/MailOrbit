import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { env } from '../config/env';

/**
 * Custom application error with HTTP status code.
 * Throw this anywhere in the request chain — the errorHandler will catch it.
 */
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global Express error handler — must be mounted LAST with 4 arguments.
 *
 * In development the full stack trace is returned.
 * In production only the message is returned.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const isDev = env.NODE_ENV === 'development';

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
        ...(isDev && { stack: err.stack }),
      },
    });
    return;
  }

  // Handle Passport OAuth errors gracefully (e.g. reused code, invalid secret)
  // These usually happen on the callback route where a redirect is expected
  if (err && ((err as Error).name === 'TokenError' || (err as Error).name === 'InternalOAuthError')) {
    const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    return;
  }

  // Knex / pg unique violation
  if ((err as { code?: string }).code === '23505') {
    res.status(409).json({
      success: false,
      error: { message: 'Resource already exists (duplicate)' },
    });
    return;
  }

  // Knex foreign key violation
  if ((err as { code?: string }).code === '23503') {
    res.status(400).json({
      success: false,
      error: { message: 'Referenced resource does not exist' },
    });
    return;
  }

  // Unknown errors
  console.error('[Error]', err);
  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      ...(isDev && { detail: (err as Error).message, stack: (err as Error).stack }),
    },
  });
};
