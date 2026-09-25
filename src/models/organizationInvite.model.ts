import type { Knex } from 'knex';
import type { InvitableRole } from '../shared/index.js';
import { db } from '../db/knex.js';

export interface OrganizationInviteRow {
  id: string;
  organization_id: string;
  email: string;
  role: InvitableRole;
  token_hash: string;
  invited_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface OrganizationInviteWithInviter extends OrganizationInviteRow {
  inviter_name: string | null;
}

const TABLE = 'organization_invites';

function pendingScope(query: Knex.QueryBuilder): Knex.QueryBuilder {
  return query
    .whereNull(`${TABLE}.accepted_at`)
    .whereNull(`${TABLE}.revoked_at`)
    .where(`${TABLE}.expires_at`, '>', db.fn.now());
}

export const OrganizationInviteModel = {
  async create(data: {
    organizationId: string;
    email: string;
    role: InvitableRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<OrganizationInviteRow> {
    const [row] = await db<OrganizationInviteRow>(TABLE)
      .insert({
        organization_id: data.organizationId,
        email: data.email.toLowerCase(),
        role: data.role,
        token_hash: data.tokenHash,
        invited_by: data.invitedBy,
        expires_at: data.expiresAt,
      })
      .returning('*');
    return row as OrganizationInviteRow;
  },

  async findPendingByTokenHash(
    tokenHash: string,
  ): Promise<OrganizationInviteWithInviter | undefined> {
    return pendingScope(
      db(TABLE)
        .leftJoin('users', 'users.id', `${TABLE}.invited_by`)
        .where(`${TABLE}.token_hash`, tokenHash),
    )
      .select(`${TABLE}.*`, 'users.name as inviter_name')
      .first();
  },

  async findPendingForEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationInviteRow | undefined> {
    return pendingScope(
      db(TABLE).where({ organization_id: organizationId, email: email.toLowerCase() }),
    ).first();
  },

  async listForOrganization(organizationId: string): Promise<OrganizationInviteWithInviter[]> {
    return db(TABLE)
      .leftJoin('users', 'users.id', `${TABLE}.invited_by`)
      .where(`${TABLE}.organization_id`, organizationId)
      .select(`${TABLE}.*`, 'users.name as inviter_name')
      .orderBy(`${TABLE}.created_at`, 'desc')
      .limit(200);
  },

  /** Revokes every still-pending invite for this email, so a re-invite leaves exactly one live link. */
  async revokePendingForEmail(organizationId: string, email: string): Promise<void> {
    await pendingScope(
      db(TABLE).where({ organization_id: organizationId, email: email.toLowerCase() }),
    ).update({ revoked_at: db.fn.now() });
  },

  async revoke(id: string, organizationId: string): Promise<boolean> {
    const count = await pendingScope(
      db(TABLE).where({ id, organization_id: organizationId }),
    ).update({ revoked_at: db.fn.now() });
    return count > 0;
  },

  /** Conditional on the invite still being pending, so two concurrent accepts can't both succeed. */
  async markAccepted(id: string, trx: Knex | Knex.Transaction = db): Promise<boolean> {
    const count = await pendingScope(trx(TABLE).where({ id })).update({
      accepted_at: trx.fn.now(),
    });
    return count > 0;
  },
};
