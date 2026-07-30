import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { hashPassword, comparePassword } from '../auth/password';
import {
  signTokenPair,
  verifyRefreshToken,
  isRefreshTokenValid,
  deleteRefreshToken,
  blocklistAccessToken,
  signRefreshToken,
  signAccessToken,
} from '../auth/jwt';
import { AppError } from '../middleware/error';
import type { DbUser } from '../types';


// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeUser(user: DbUser) {
  const { password_hash: _ph, ...rest } = user;
  return rest;
}

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d

function setRefreshCookie(res: Response, token: string): void {
  const isProd = process.env['NODE_ENV'] === 'production';
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd, // Must be true when sameSite is 'none'
    sameSite: isProd ? 'none' : 'lax', // 'none' required for cross-site (Vercel <-> Render)
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res: Response): void {
  const isProd = process.env['NODE_ENV'] === 'production';
  res.clearCookie(REFRESH_COOKIE, {
    path: '/api/auth',
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────────────────────────────────────

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = registerSchema.parse(req.body);

    const existing = await db<DbUser>('users')
      .where('email', body.email)
      .first();
    if (existing) throw new AppError('Email already registered', 409);

    const password_hash = await hashPassword(body.password);

    const [user] = await db<DbUser>('users')
      .insert({ name: body.name, email: body.email, password_hash })
      .returning('*');

    if (!user) throw new AppError('Failed to create user', 500);

    const { accessToken, refreshToken } = await signTokenPair(user.id);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      success: true,
      data: { user: safeUser(user), accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = loginSchema.parse(req.body);

    let user = await db<DbUser>('users')
      .where('email', body.email)
      .first();

    if (!user) {
      // Auto-register the user if they don't exist
      const password_hash = await hashPassword(body.password);
      const name = body.email.split('@')[0]; // Use the email prefix as a default name
      
      const [newUser] = await db<DbUser>('users')
        .insert({ name, email: body.email, password_hash })
        .returning('*');
        
      if (!newUser) throw new AppError('Failed to create user', 500);
      user = newUser;
    } else {
      // User exists, verify password
      if (!user.password_hash) {
        throw new AppError('Invalid credentials', 401);
      }
      const valid = await comparePassword(body.password, user.password_hash);
      if (!valid) throw new AppError('Invalid credentials', 401);
    }

    const { accessToken, refreshToken } = await signTokenPair(user.id);
    setRefreshCookie(res, refreshToken);

    res.json({
      success: true,
      data: { user: safeUser(user), accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function googleCallback(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  // req.user is populated by Passport after the OAuth dance
  const user = req.user!;
  const { accessToken, refreshToken } = await signTokenPair(user.id);

  // Redirect to frontend with tokens in query params.
  // The React app reads them once and stores accessToken in memory,
  // refreshToken in httpOnly cookie (set below), then clears the URL.
  setRefreshCookie(res, refreshToken);

  const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
  res.redirect(
    `${frontendUrl}/auth/callback?token=${encodeURIComponent(accessToken)}`,
  );
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token: string | undefined = req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError('No refresh token', 401);

    const payload = verifyRefreshToken(token);

    const valid = await isRefreshTokenValid(payload.sub, payload.jti);
    if (!valid) throw new AppError('Refresh token revoked or expired', 401);

    // Rotate: delete old token, issue new pair
    await deleteRefreshToken(payload.sub, payload.jti);
    const newAccessToken = signAccessToken(payload.sub);
    const newRefreshToken = await signRefreshToken(payload.sub);

    setRefreshCookie(res, newRefreshToken);
    res.json({ success: true, data: { accessToken: newAccessToken } });
  } catch (err) {
    next(err);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const jti = req.jti;
    const userId = req.user?.id;

    if (jti && req.user) {
      // Blocklist the access token
      const authHeader = req.headers.authorization!;
      const token = authHeader.slice(7);
      const { exp } = JSON.parse(
        Buffer.from(token.split('.')[1]!, 'base64').toString(),
      ) as { exp: number };
      await blocklistAccessToken(jti, exp);
    }

    // Delete refresh token if present
    const refreshCookie: string | undefined = req.cookies[REFRESH_COOKIE];
    if (refreshCookie && userId) {
      try {
        const payload = verifyRefreshToken(refreshCookie);
        await deleteRefreshToken(userId, payload.jti);
      } catch {
        // Token might already be expired — that's fine
      }
    }

    clearRefreshCookie(res);
    res.json({ success: true, data: { message: 'Logged out' } });
  } catch (err) {
    next(err);
  }
}

export function me(req: Request, res: Response): void {
  res.json({ success: true, data: { user: safeUser(req.user!) } });
}
