import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

// Load .env when this file is executed directly by the knex CLI
dotenv.config();

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    connection: process.env['DATABASE_URL'],
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
    pool: { min: 2, max: 10 },
  },
  production: {
    client: 'pg',
    connection: {
      connectionString: process.env['DATABASE_URL'],
      ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : false,
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
    pool: { min: 2, max: 20 },
  },
};

export default config;
module.exports = config; // CommonJS compat for knex CLI
