import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('campaigns', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Optional idempotency key — re-submitting with the same key returns the existing campaign
    t.string('idempotency_key', 255).unique().nullable();

    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('sender_id').notNullable().references('id').inTable('senders').onDelete('RESTRICT');

    t.text('subject').notNullable();
    t.text('body').notNullable();

    // When the first email in the campaign should be sent
    t.timestamp('scheduled_start', { useTz: true }).notNullable();

    // Milliseconds between each consecutive email send (staggering)
    t.integer('delay_between_emails_ms').notNullable().defaultTo(0);

    // 0 = use global MAX_EMAILS_PER_HOUR_PER_SENDER from env
    t.integer('hourly_limit').notNullable().defaultTo(0);

    t.integer('total_recipients').notNullable().defaultTo(0);

    // pending → running → completed | failed
    t.enu('status', ['pending', 'running', 'completed', 'failed'], {
      useNative: true,
      enumName: 'campaign_status',
    })
      .notNullable()
      .defaultTo('pending');

    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('campaigns', (t) => {
    t.index(['user_id']);
    t.index(['sender_id']);
    t.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('campaigns');
  await knex.raw('DROP TYPE IF EXISTS campaign_status');
}
