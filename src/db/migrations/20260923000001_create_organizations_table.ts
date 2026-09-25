import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organizations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 120).notNullable();
    table.string('slug', 140).notNullable().unique();
    table.string('email', 255).notNullable().unique();
    table.string('website', 255).nullable();
    table.string('industry', 80).nullable();
    table.string('size', 20).nullable();
    table.string('country', 80).nullable();
    table.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  await knex.schema.alterTable('users', (table) => {
    table
      .uuid('organization_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    table.index(['organization_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('organization_id');
  });
  await knex.schema.dropTableIfExists('organizations');
}
