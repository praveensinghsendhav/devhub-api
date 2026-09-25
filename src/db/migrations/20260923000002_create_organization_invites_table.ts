import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organization_invites', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    table.string('email', 255).notNullable();
    table.string('role', 32).notNullable();
    // Only the SHA-256 of the emailed token is stored, same as refresh tokens.
    table.string('token_hash', 64).notNullable().unique();
    table.uuid('invited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('expires_at').notNullable();
    table.timestamp('accepted_at').nullable();
    table.timestamp('revoked_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_invites');
}
