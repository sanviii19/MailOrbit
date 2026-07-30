import { redis } from '../redis/client';

/**
 * Per-sender per-hour rate limiter using a Redis Lua script.
 *
 * Strategy:
 *   Key: `rate:<senderId>:<YYYY-MM-DD-HH>` (UTC hour window)
 *   On each worker attempt, atomically INCR the counter.
 *   If the new count exceeds `limit`, DECR (roll back) and return false.
 *   Key expires after 2 hours for automatic cleanup.
 *
 * The Lua script executes atomically on the Redis server — safe across
 * any number of workers or backend instances without race conditions.
 */

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])

local current = redis.call('INCR', key)

if current == 1 then
  -- First increment this hour — set TTL for auto-cleanup (2h)
  redis.call('EXPIRE', key, 7200)
end

if current > limit then
  -- Over limit: roll back and signal the caller
  redis.call('DECR', key)
  return 0
end

return 1
`;

/**
 * Returns the Redis key for the current UTC hour window.
 * Format: `rate:<senderId>:2024-11-05-14`
 */
function currentHourKey(senderId: string): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `rate:${senderId}:${y}-${mo}-${d}-${h}`;
}

/**
 * Returns the Unix timestamp (ms) at the start of the NEXT UTC hour.
 * Jobs that are rate-limited are re-delayed to this timestamp.
 */
export function getNextHourTimestamp(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours() + 1,
      0,
      0,
      0,
    ),
  );
  return next.getTime();
}

/**
 * Atomically checks and increments the per-sender hourly counter.
 *
 * @param senderId - The sender's DB UUID
 * @param limit    - Max emails allowed this hour for this sender
 * @returns        - true if under the limit and counter was incremented,
 *                   false if the limit was reached (counter NOT incremented)
 */
export async function checkAndIncrement(
  senderId: string,
  limit: number,
): Promise<boolean> {
  const key = currentHourKey(senderId);
  const result = await redis.eval(RATE_LIMIT_LUA, 1, key, String(limit)) as number;
  return result === 1;
}

/**
 * Get the current usage count for a sender in the current hour.
 * Used for stats/debugging — does NOT increment.
 */
export async function getCurrentUsage(senderId: string): Promise<number> {
  const key = currentHourKey(senderId);
  const val = await redis.get(key);
  return val ? parseInt(val, 10) : 0;
}
