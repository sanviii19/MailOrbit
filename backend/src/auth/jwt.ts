import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { redis } from '../redis/client';
import type { JwtAccessPayload, JwtRefreshPayload } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Duration parser: '15m' → 900, '7d' → 604800, '1h' → 3600
// ─────────────────────────────────────────────────────────────────────────────

function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────────────────────

const refreshKey = (userId: string, jti: string) =>
  `refresh:${userId}:${jti}`;

const blocklistKey = (jti: string) => `blocklist:${jti}`;

// ─────────────────────────────────────────────────────────────────────────────
// Sign tokens
// ─────────────────────────────────────────────────────────────────────────────

export function signAccessToken(userId: string): string {
  const jti = uuidv4();
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId, type: 'access', jti }, env.JWT_SECRET, options);
}

export async function signRefreshToken(userId: string): Promise<string> {
  const jti = uuidv4();
  const options: SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'] };
  const token = jwt.sign({ sub: userId, type: 'refresh', jti }, env.JWT_SECRET, options);

  // Store in Redis — any worker instance can verify
  const ttlSec = parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN);
  await redis.setex(refreshKey(userId, jti), ttlSec, '1');

  return token;
}

export async function signTokenPair(
  userId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId),
    signRefreshToken(userId),
  ]);
  return { accessToken, refreshToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify
// ─────────────────────────────────────────────────────────────────────────────

export function verifyAccessToken(token: string): JwtAccessPayload {
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtAccessPayload;
  if (payload.type !== 'access') {
    throw new jwt.JsonWebTokenError('Invalid token type');
  }
  return payload;
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtRefreshPayload;
  if (payload.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Invalid token type');
  }
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocklist / revocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add an access token's jti to the Redis blocklist.
 * TTL is set to the token's remaining lifetime so the key auto-cleans.
 */
export async function blocklistAccessToken(
  jti: string,
  exp: number,
): Promise<void> {
  const remaining = exp - Math.floor(Date.now() / 1000);
  if (remaining > 0) {
    await redis.setex(blocklistKey(jti), remaining, '1');
  }
}

export async function isAccessTokenBlocklisted(jti: string): Promise<boolean> {
  const exists = await redis.exists(blocklistKey(jti));
  return exists === 1;
}

/**
 * Delete a refresh token from Redis (used on logout and token rotation).
 */
export async function deleteRefreshToken(
  userId: string,
  jti: string,
): Promise<void> {
  await redis.del(refreshKey(userId, jti));
}

/**
 * Check that a refresh token's jti still exists in Redis.
 * Returns false if it was already used (rotation) or if it was revoked.
 */
export async function isRefreshTokenValid(
  userId: string,
  jti: string,
): Promise<boolean> {
  const exists = await redis.exists(refreshKey(userId, jti));
  return exists === 1;
}
