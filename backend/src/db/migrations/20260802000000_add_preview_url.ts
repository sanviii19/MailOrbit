import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('email_jobs', 'preview_url');
  if (!hasColumn) {
    await knex.schema.alterTable('email_jobs', (t) => {
      t.text('preview_url').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('email_jobs', 'preview_url');
  if (hasColumn) {
    await knex.schema.alterTable('email_jobs', (t) => {
      t.dropColumn('preview_url');
    });
  }
}
