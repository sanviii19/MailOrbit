import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('email_jobs', (t) => {
    // id IS the BullMQ jobId (deterministic UUID v5 = namespace + campaignId + recipientEmail)
    // This enforces idempotency at both the DB and queue layers simultaneously
    t.uuid('id').primary();

    t.uuid('campaign_id').notNullable().references('id').inTable('campaigns').onDelete('CASCADE');
    t.uuid('sender_id').notNullable().references('id').inTable('senders').onDelete('RESTRICT');

    t.string('recipient_email', 255).notNullable();
    t.text('subject').notNullable();
    t.text('body').notNullable();

    t.timestamp('scheduled_at', { useTz: true }).notNullable();
    t.timestamp('sent_at', { useTz: true }).nullable();

    /**
     * Status lifecycle:
     *   scheduled   — job is in BullMQ delayed set, waiting to fire
     *   rate_limited — hourly cap hit; job re-delayed to next hour window
     *   sent         — email delivered via SMTP successfully
     *   failed       — all BullMQ retry attempts exhausted
     *   cancelled    — manually cancelled before send (job removed from queue)
     */
    t.enu(
      'status',
      ['scheduled', 'rate_limited', 'sent', 'failed', 'cancelled'],
      { useNative: true, enumName: 'email_job_status' },
    )
      .notNullable()
      .defaultTo('scheduled');

    t.integer('attempts').notNullable().defaultTo(0);
    t.text('error_message').nullable();

    // User can star/bookmark individual emails (visible in Figma)
    t.boolean('starred').notNullable().defaultTo(false);

    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    // Core idempotency constraint: one job per (campaign, recipient) pair
    t.unique(['campaign_id', 'recipient_email']);
  });

  // Indexes for common query patterns
  await knex.schema.alterTable('email_jobs', (t) => {
    t.index(['campaign_id']);
    t.index(['sender_id']);
    t.index(['status']);
    t.index(['scheduled_at']);
    t.index(['recipient_email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('email_jobs');
  await knex.raw('DROP TYPE IF EXISTS email_job_status');
}
