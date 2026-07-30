import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaigns', (t) => {
    t.jsonb('attachments').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaigns', (t) => {
    t.dropColumn('attachments');
  });
}
