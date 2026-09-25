import type { Knex } from 'knex';

/**
 * Meetings (instant calls and scheduled meetings) and who's invited to them. Who is *in* a call
 * right now isn't stored here — that's the live socket room, so it can never go stale.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('meetings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('organization_id')
      .nullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    // Title and description are encrypted at rest (models/meeting.model.ts), hence `text`.
    table.text('title').notNullable();
    table.text('description').nullable();
    table.string('kind', 16).notNullable();
    table.string('media', 16).notNullable().defaultTo('video');
    table.string('status', 16).notNullable().defaultTo('scheduled');
    table.timestamp('starts_at').notNullable();
    table.timestamp('ends_at').notNullable();
    table.timestamp('started_at').nullable();
    table.timestamp('ended_at').nullable();
    table.boolean('allow_invites').notNullable().defaultTo(true);
    table.boolean('mute_on_join').notNullable().defaultTo(false);
    table.boolean('is_locked').notNullable().defaultTo(false);
    table.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamps(true, true);
    table.index(['organization_id', 'starts_at']);
  });

  await knex.schema.createTable('meeting_participants', (table) => {
    table.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('role', 16).notNullable().defaultTo('participant');
    table.string('rsvp', 16).notNullable().defaultTo('pending');
    table.uuid('invited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    // Removed by a host: can't rejoin unless someone invites them again.
    table.timestamp('removed_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['meeting_id', 'user_id']);
    // Calendar lookups go user → meetings.
    table.index(['user_id', 'rsvp']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_participants');
  await knex.schema.dropTableIfExists('meetings');
}
