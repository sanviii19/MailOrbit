import knex from 'knex';
import { env } from '../config/env';

/**
 * Singleton Knex instance shared across the application.
 * Pool is managed by Knex — no manual connection management needed.
 */
export const db = knex({
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    ssl:
      env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  },
  pool: {
    min: 2,
    max: env.NODE_ENV === 'production' ? 20 : 10,
    // Destroy idle connections after 30s
    idleTimeoutMillis: 30_000,
    // Fail fast if we can't get a connection in 5s
    acquireTimeoutMillis: 5_000,
  },
  // Log queries in development
  debug: env.NODE_ENV === 'development' && process.env['KNEX_DEBUG'] === 'true',
});
