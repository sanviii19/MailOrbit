import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('google_id', 255).unique().nullable();
    t.string('email', 255).unique().notNullable();
    t.string('name', 255).notNullable();
    t.text('avatar_url').nullable();
    t.text('password_hash').nullable(); // null for OAuth-only users
    t.timestamps(true, true);           // created_at, updated_at
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
