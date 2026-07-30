import Redis from 'ioredis';
import { env } from '../config/env';

/**
 * Singleton ioredis client shared across the app (BullMQ, JWT blocklist,
 * refresh-token store, rate-limit counters).
 *
 * ioredis has built-in reconnect logic with exponential backoff.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000); // max 5s between retries
    console.warn(`[Redis] Reconnecting... attempt ${times}, delay ${delay}ms`);
    return delay;
  },
  reconnectOnError(err) {
    // Reconnect on READONLY errors (happens during Redis failover)
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) return true;
    return false;
  },
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('close', () => console.warn('[Redis] Connection closed'));
