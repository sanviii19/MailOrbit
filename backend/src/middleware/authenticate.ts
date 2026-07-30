import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, isAccessTokenBlocklisted } from '../auth/jwt';
import { db } from '../db/client';
import { AppError } from './error';
import type { DbUser } from '../types';

/**
 * Express middleware that validates the JWT access token on every protected route.
 *
 * Flow:
 *   1. Extract Bearer token from Authorization header
 *   2. Verify signature and expiry (synchronous)
 *   3. Check Redis blocklist (async) — catches logged-out tokens
 *   4. Load the user from DB and attach to req.user
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token); // throws if invalid/expired

    // Check blocklist (logged-out tokens)
    const blocklisted = await isAccessTokenBlocklisted(payload.jti);
    if (blocklisted) {
      throw new AppError('Token has been revoked', 401);
    }

    // Load user
    const user = await db<DbUser>('users')
      .where('id', payload.sub)
      .first();

    if (!user) {
      throw new AppError('User not found', 401);
    }

    req.user = user;
    req.jti = payload.jti;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else if ((err as Error).name === 'TokenExpiredError') {
      next(new AppError('Token expired', 401));
    } else if ((err as Error).name === 'JsonWebTokenError') {
      next(new AppError('Invalid token', 401));
    } else {
      next(err);
    }
  }
}
