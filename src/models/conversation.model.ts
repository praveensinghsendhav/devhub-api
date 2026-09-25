import type { ConversationRole, ConversationType, PresenceStatus } from '../shared/index.js';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { decryptBody } from './message.model.js';

export interface ConversationRow {
  id: string;
  type: ConversationType;
  name: string | null;
  description: string | null;
  only_admins_can_post: boolean;
  is_org_wide: boolean;
  organization_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationMemberRow {
  conversation_id: string;
  user_id: string;
  role: ConversationRole;
  last_read_at: Date;
  last_delivered_at: Date;
  joined_at: Date;
}

export interface ConversationMemberDetailRow extends ConversationMemberRow {
  name: string;
  email: string;
  avatar_url: string | null;
  status: PresenceStatus | null;
  custom_status: string | null;
  last_seen_at: Date | null;
}

export interface LastMessageRow {
  conversation_id: string;
  id: string;
  body: string;
  type: 'text' | 'system';
  sender_id: string;
  sender_name: string;
  deleted_at: Date | null;
  created_at: Date;
}

type Executor = Knex | Knex.Transaction;

const CONVERSATIONS = 'conversations';
const MEMBERS = 'conversation_members';

export const ConversationModel = {
  async findById(id: string, trx: Executor = db): Promise<ConversationRow | undefined> {
    return trx<ConversationRow>(CONVERSATIONS).where({ id }).first();
  },

  async listIdsForUser(userId: string): Promise<string[]> {
    const rows = await db<ConversationMemberRow>(MEMBERS)
      .where({ user_id: userId })
      .select('conversation_id');
    return rows.map((row) => row.conversation_id);
  },

  async findByIds(ids: string[]): Promise<ConversationRow[]> {
    if (ids.length === 0) return [];
    return db<ConversationRow>(CONVERSATIONS).whereIn('id', ids).orderBy('updated_at', 'desc');
  },

  async getMembers(conversationIds: string[]): Promise<ConversationMemberDetailRow[]> {
    if (conversationIds.length === 0) return [];
    return db(MEMBERS)
      .join('users', 'users.id', `${MEMBERS}.user_id`)
      .leftJoin('user_status', 'user_status.user_id', `${MEMBERS}.user_id`)
      .whereIn(`${MEMBERS}.conversation_id`, conversationIds)
      .select(
        `${MEMBERS}.*`,
        'users.name',
        'users.email',
        'users.avatar_url',
        'user_status.status',
        'user_status.custom_status',
        'user_status.last_seen_at',
      )
      .orderBy([
        { column: `${MEMBERS}.role`, order: 'asc' },
        { column: 'users.name', order: 'asc' },
      ]);
  },

  async getMember(
    conversationId: string,
    userId: string,
    trx: Executor = db,
  ): Promise<ConversationMemberRow | undefined> {
    return trx<ConversationMemberRow>(MEMBERS)
      .where({ conversation_id: conversationId, user_id: userId })
      .first();
  },

  async countAdmins(conversationId: string, trx: Executor = db): Promise<number> {
    const [row] = await trx(MEMBERS)
      .where({ conversation_id: conversationId, role: 'admin' })
      .count<{ count: string }[]>({ count: '*' });
    return Number(row?.count ?? 0);
  },

  /** The longest-standing remaining member, used to hand over admin when the last admin leaves. */
  async findOldestMember(
    conversationId: string,
    trx: Executor = db,
  ): Promise<ConversationMemberRow | undefined> {
    return trx<ConversationMemberRow>(MEMBERS)
      .where({ conversation_id: conversationId })
      .orderBy('joined_at', 'asc')
      .first();
  },

  async getLastMessages(conversationIds: string[]): Promise<LastMessageRow[]> {
    if (conversationIds.length === 0) return [];
    const rows: LastMessageRow[] = await db
      .select(
        'm.conversation_id',
        'm.id',
        'm.body',
        'm.type',
        'm.sender_id',
        'm.deleted_at',
        'm.created_at',
        'u.name as sender_name',
      )
      .from(
        db('messages')
          .whereIn('conversation_id', conversationIds)
          .distinctOn('conversation_id')
          .orderBy([
            { column: 'conversation_id' },
            { column: 'created_at', order: 'desc' },
            { column: 'id', order: 'desc' },
          ])
          .select('*')
          .as('m'),
      )
      .join('users as u', 'u.id', 'm.sender_id');
    return rows.map((row) => ({ ...row, body: decryptBody(row.body) }));
  },

  /** Unread = other people's text messages after my last_read_at — one grouped query for all conversations. */
  async getUnreadCounts(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await db(`${MEMBERS} as cm`)
      .leftJoin('messages as m', function joinUnread() {
        this.on('m.conversation_id', '=', 'cm.conversation_id')
          .andOn('m.created_at', '>', 'cm.last_read_at')
          .andOn('m.sender_id', '<>', 'cm.user_id')
          .andOnVal('m.type', '=', 'text')
          .andOnNull('m.deleted_at');
      })
      .where('cm.user_id', userId)
      .whereIn('cm.conversation_id', conversationIds)
      .groupBy('cm.conversation_id')
      .select<{ conversation_id: string; count: string }[]>(
        'cm.conversation_id',
        db.raw('count(m.id) as count'),
      );
    return new Map(rows.map((row) => [row.conversation_id, Number(row.count)]));
  },

  async findDirectBetween(userId: string, otherUserId: string): Promise<string | undefined> {
    const row = await db(`${MEMBERS} as a`)
      .join(`${MEMBERS} as b`, 'a.conversation_id', 'b.conversation_id')
      .join(`${CONVERSATIONS} as c`, 'c.id', 'a.conversation_id')
      .where('c.type', 'direct')
      .andWhere('a.user_id', userId)
      .andWhere('b.user_id', otherUserId)
      .select('c.id')
      .first<{ id: string } | undefined>();
    return row?.id;
  },

  async listOrgWideBroadcastIds(organizationId: string, trx: Executor = db): Promise<string[]> {
    const rows = await trx<ConversationRow>(CONVERSATIONS)
      .where({ organization_id: organizationId, is_org_wide: true, type: 'broadcast' })
      .select('id');
    return rows.map((row) => row.id);
  },

  async create(
    params: {
      type: ConversationType;
      name: string | null;
      description?: string | null;
      onlyAdminsCanPost?: boolean;
      isOrgWide?: boolean;
      organizationId: string | null;
      createdBy: string;
    },
    trx: Executor = db,
  ): Promise<ConversationRow> {
    const [row] = await trx<ConversationRow>(CONVERSATIONS)
      .insert({
        type: params.type,
        name: params.name,
        description: params.description ?? null,
        only_admins_can_post: params.onlyAdminsCanPost ?? false,
        is_org_wide: params.isOrgWide ?? false,
        organization_id: params.organizationId,
        created_by: params.createdBy,
      })
      .returning('*');
    return row as ConversationRow;
  },

  async update(
    id: string,
    changes: Partial<Pick<ConversationRow, 'name' | 'description' | 'only_admins_can_post'>>,
    trx: Executor = db,
  ): Promise<void> {
    await trx<ConversationRow>(CONVERSATIONS)
      .where({ id })
      .update({ ...changes, updated_at: trx.fn.now() });
  },

  async delete(id: string, trx: Executor = db): Promise<void> {
    await trx(CONVERSATIONS).where({ id }).delete();
  },

  async addMembers(
    conversationId: string,
    members: { userId: string; role: ConversationRole }[],
    trx: Executor = db,
  ): Promise<string[]> {
    if (members.length === 0) return [];
    const rows = await trx<ConversationMemberRow>(MEMBERS)
      .insert(
        members.map((m) => ({ conversation_id: conversationId, user_id: m.userId, role: m.role })),
      )
      .onConflict(['conversation_id', 'user_id'])
      .ignore()
      .returning('user_id');
    return rows.map((row) => row.user_id);
  },

  async removeMember(conversationId: string, userId: string, trx: Executor = db): Promise<boolean> {
    const count = await trx(MEMBERS)
      .where({ conversation_id: conversationId, user_id: userId })
      .delete();
    return count > 0;
  },

  async setRole(
    conversationId: string,
    userId: string,
    role: ConversationRole,
    trx: Executor = db,
  ): Promise<void> {
    await trx(MEMBERS).where({ conversation_id: conversationId, user_id: userId }).update({ role });
  },

  async markRead(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMemberRow | undefined> {
    const [row] = await db<ConversationMemberRow>(MEMBERS)
      .where({ conversation_id: conversationId, user_id: userId })
      // Reading implies delivery too.
      .update({ last_read_at: db.fn.now(), last_delivered_at: db.fn.now() })
      .returning('*');
    return row as ConversationMemberRow | undefined;
  },

  async markDelivered(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMemberRow | undefined> {
    const [row] = await db<ConversationMemberRow>(MEMBERS)
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ last_delivered_at: db.fn.now() })
      .returning('*');
    return row as ConversationMemberRow | undefined;
  },

  async markAllDeliveredForUser(userId: string): Promise<ConversationMemberRow[]> {
    return db<ConversationMemberRow>(MEMBERS)
      .where({ user_id: userId })
      .update({ last_delivered_at: db.fn.now() })
      .returning('*');
  },

  async touchUpdatedAt(conversationId: string, trx: Executor = db): Promise<void> {
    await trx<ConversationRow>(CONVERSATIONS)
      .where({ id: conversationId })
      .update({ updated_at: trx.fn.now() });
  },

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    return Boolean(await ConversationModel.getMember(conversationId, userId));
  },
};
