import type { Knex } from 'knex';

/**
 * Chat v2: groups + broadcasts with per-conversation roles, delivery receipts, replies,
 * edits/soft deletes, system messages and reactions.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversations', (table) => {
    table.text('description').nullable();
    table.boolean('only_admins_can_post').notNullable().defaultTo(false);
    table.boolean('is_org_wide').notNullable().defaultTo(false);
    table
      .uuid('organization_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    table.index(['organization_id', 'is_org_wide']);
  });

  // Existing conversations belong to their creator's organization.
  await knex.raw(`
    UPDATE conversations c SET organization_id = u.organization_id
    FROM users u WHERE u.id = c.created_by
  `);

  await knex.schema.alterTable('conversation_members', (table) => {
    table.string('role', 16).notNullable().defaultTo('member');
    table.timestamp('last_delivered_at').notNullable().defaultTo(knex.fn.now());
    table.index(['user_id']);
  });

  await knex.raw(`
    UPDATE conversation_members cm SET role = 'admin'
    FROM conversations c
    WHERE c.id = cm.conversation_id AND c.created_by = cm.user_id AND c.type <> 'direct'
  `);

  await knex.schema.alterTable('messages', (table) => {
    table.string('type', 16).notNullable().defaultTo('text');
    table.uuid('reply_to_id').nullable().references('id').inTable('messages').onDelete('SET NULL');
    table.timestamp('edited_at').nullable();
    table.timestamp('deleted_at').nullable();
  });

  await knex.schema.createTable('message_reactions', (table) => {
    table.uuid('message_id').notNullable().references('id').inTable('messages').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('emoji', 16).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['message_id', 'user_id', 'emoji']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('message_reactions');
  await knex.schema.alterTable('messages', (table) => {
    table.dropColumn('deleted_at');
    table.dropColumn('edited_at');
    table.dropColumn('reply_to_id');
    table.dropColumn('type');
  });
  await knex.schema.alterTable('conversation_members', (table) => {
    table.dropIndex(['user_id']);
    table.dropColumn('last_delivered_at');
    table.dropColumn('role');
  });
  await knex.schema.alterTable('conversations', (table) => {
    table.dropIndex(['organization_id', 'is_org_wide']);
    table.dropColumn('organization_id');
    table.dropColumn('is_org_wide');
    table.dropColumn('only_admins_can_post');
    table.dropColumn('description');
  });
}
