import type { Knex } from 'knex';
import type { MessageType, ReactionEmoji } from '../shared/index.js';
import { db } from '../db/knex.js';
import { decryptField, encryptField } from '../common/utils/fieldEncryption.js';

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  body: string;
  reply_to_id: string | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

/** A message joined with its sender and (if any) the message it replies to. */
export interface MessageDetailRow extends MessageRow {
  sender_name: string;
  sender_avatar_url: string | null;
  reply_body: string | null;
  reply_sender_id: string | null;
  reply_sender_name: string | null;
  reply_deleted_at: Date | null;
}

export interface ReactionRow {
  message_id: string;
  user_id: string;
  emoji: ReactionEmoji;
  created_at: Date;
}

type Executor = Knex | Knex.Transaction;

const TABLE = 'messages';
const REACTIONS = 'message_reactions';

/** `messages.body` is encrypted at rest; this model is the only place it's encrypted or decrypted. */
const BODY_CONTEXT = 'messages.body';

export const encryptBody = (body: string) => encryptField(body, BODY_CONTEXT);
export const decryptBody = (stored: string) => decryptField(stored, BODY_CONTEXT);

function decryptRow<T extends MessageRow>(row: T): T;
function decryptRow<T extends MessageRow>(row: T | undefined): T | undefined;
function decryptRow<T extends MessageRow>(row: T | undefined): T | undefined {
  if (!row) return row;
  const decrypted = { ...row, body: decryptBody(row.body) };
  if ('reply_body' in decrypted && typeof decrypted.reply_body === 'string') {
    decrypted.reply_body = decryptBody(decrypted.reply_body);
  }
  return decrypted;
}

function detailQuery(executor: Executor = db): Knex.QueryBuilder {
  return executor(`${TABLE} as m`)
    .join('users as u', 'u.id', 'm.sender_id')
    .leftJoin(`${TABLE} as r`, 'r.id', 'm.reply_to_id')
    .leftJoin('users as ru', 'ru.id', 'r.sender_id')
    .select(
      'm.*',
      'u.name as sender_name',
      'u.avatar_url as sender_avatar_url',
      'r.body as reply_body',
      'r.sender_id as reply_sender_id',
      'ru.name as reply_sender_name',
      'r.deleted_at as reply_deleted_at',
    );
}

export const MessageModel = {
  async create(
    params: {
      conversationId: string;
      senderId: string;
      body: string;
      type?: MessageType;
      replyToId?: string | null;
    },
    trx: Executor = db,
  ): Promise<MessageRow> {
    const [row] = await trx<MessageRow>(TABLE)
      .insert({
        conversation_id: params.conversationId,
        sender_id: params.senderId,
        body: encryptBody(params.body),
        type: params.type ?? 'text',
        reply_to_id: params.replyToId ?? null,
      })
      .returning('*');
    return decryptRow(row as MessageRow);
  },

  async findById(id: string): Promise<MessageRow | undefined> {
    return decryptRow(await db<MessageRow>(TABLE).where({ id }).first());
  },

  async findDetailById(id: string): Promise<MessageDetailRow | undefined> {
    return decryptRow<MessageDetailRow>(await detailQuery().where('m.id', id).first());
  },

  /**
   * Cursor pagination, newest first: `before` is a message id; everything strictly older is returned.
   * Fetches one extra row to know whether more history exists.
   */
  async listByConversation(
    conversationId: string,
    limit: number,
    before?: string,
  ): Promise<{ rows: MessageDetailRow[]; hasMore: boolean }> {
    const query = detailQuery()
      .where('m.conversation_id', conversationId)
      .orderBy([
        { column: 'm.created_at', order: 'desc' },
        { column: 'm.id', order: 'desc' },
      ])
      .limit(limit + 1);

    if (before) {
      query.whereRaw('(m.created_at, m.id) < (select created_at, id from messages where id = ?)', [
        before,
      ]);
    }

    const rows: MessageDetailRow[] = await query;
    return {
      rows: rows.slice(0, limit).map((row) => decryptRow(row)),
      hasMore: rows.length > limit,
    };
  },

  /** Broadcast posts in [from, to) from announcement channels this user belongs to — for the calendar. */
  async listAnnouncementsForUser(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<(MessageRow & { sender_name: string; conversation_name: string | null })[]> {
    const rows: (MessageRow & { sender_name: string; conversation_name: string | null })[] =
      await db(`${TABLE} as m`)
        .join('conversations as c', 'c.id', 'm.conversation_id')
        .join('conversation_members as cm', function joinMember() {
          this.on('cm.conversation_id', '=', 'm.conversation_id').andOnVal(
            'cm.user_id',
            '=',
            userId,
          );
        })
        .join('users as u', 'u.id', 'm.sender_id')
        .where('c.type', 'broadcast')
        .where('m.type', 'text')
        .whereNull('m.deleted_at')
        .where('m.created_at', '>=', from)
        .where('m.created_at', '<', to)
        .orderBy('m.created_at', 'asc')
        .limit(300)
        .select('m.*', 'u.name as sender_name', 'c.name as conversation_name');
    return rows.map((row) => decryptRow(row));
  },

  async updateBody(id: string, body: string): Promise<void> {
    await db<MessageRow>(TABLE)
      .where({ id })
      .update({ body: encryptBody(body), edited_at: db.fn.now() });
  },

  /** Soft delete: the row stays for ordering/replies, but its content is wiped. */
  async softDelete(id: string): Promise<void> {
    await db.transaction(async (trx) => {
      await trx<MessageRow>(TABLE).where({ id }).update({ body: '', deleted_at: trx.fn.now() });
      await trx(REACTIONS).where({ message_id: id }).delete();
    });
  },

  async listReactions(messageIds: string[]): Promise<ReactionRow[]> {
    if (messageIds.length === 0) return [];
    return db<ReactionRow>(REACTIONS)
      .whereIn('message_id', messageIds)
      .orderBy('created_at', 'asc');
  },

  /** Adds the reaction, or removes it if this user already reacted with this emoji. */
  async toggleReaction(messageId: string, userId: string, emoji: ReactionEmoji): Promise<void> {
    const removed = await db(REACTIONS)
      .where({ message_id: messageId, user_id: userId, emoji })
      .delete();
    if (removed === 0) {
      await db(REACTIONS)
        .insert({ message_id: messageId, user_id: userId, emoji })
        .onConflict(['message_id', 'user_id', 'emoji'])
        .ignore();
    }
  },
};
