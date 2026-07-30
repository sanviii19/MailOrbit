import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('senders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');

    // Display name shown in the "From" dropdown
    t.string('name', 255).notNullable();

    // Ethereal (or real) SMTP from-address
    t.string('email', 255).notNullable();

    // SMTP credentials — stored in plaintext for Ethereal (test-only)
    // In production, encrypt smtp_pass at the application layer before storing
    t.string('smtp_host', 255).notNullable();
    t.integer('smtp_port').notNullable();
    t.string('smtp_user', 255).notNullable();
    t.text('smtp_pass').notNullable();

    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Index so looking up senders by user is fast
  await knex.schema.alterTable('senders', (t) => {
    t.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('senders');
}
