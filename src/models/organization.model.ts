import type { Knex } from 'knex';
import type { OrganizationSize } from '../shared/index.js';
import { db } from '../db/knex.js';
import { queryFactory } from '../db/factory/queryFactory.js';

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  email: string;
  website: string | null;
  industry: string | null;
  size: OrganizationSize | null;
  country: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const TABLE = 'organizations';

export const OrganizationModel = {
  async findById(id: string): Promise<OrganizationRow | undefined> {
    return db<OrganizationRow>(TABLE).where({ id }).first();
  },

  async findByIdOrThrow(id: string): Promise<OrganizationRow> {
    return queryFactory.findOneOrThrow<OrganizationRow>(
      db<OrganizationRow>(TABLE).where({ id }),
      'Organization not found',
    );
  },

  async existsByEmail(email: string): Promise<boolean> {
    return queryFactory.exists(db<OrganizationRow>(TABLE).where({ email: email.toLowerCase() }));
  },

  async existsBySlug(slug: string): Promise<boolean> {
    return queryFactory.exists(db<OrganizationRow>(TABLE).where({ slug }));
  },

  async create(
    data: {
      name: string;
      slug: string;
      email: string;
      website?: string | null;
      industry?: string | null;
      size?: OrganizationSize | null;
      country?: string | null;
    },
    trx: Knex | Knex.Transaction = db,
  ): Promise<OrganizationRow> {
    const [row] = await trx<OrganizationRow>(TABLE)
      .insert({
        name: data.name,
        slug: data.slug,
        email: data.email.toLowerCase(),
        website: data.website ?? null,
        industry: data.industry ?? null,
        size: data.size ?? null,
        country: data.country ?? null,
      })
      .returning('*');
    return row as OrganizationRow;
  },

  async setCreatedBy(id: string, userId: string, trx: Knex | Knex.Transaction = db): Promise<void> {
    await trx(TABLE).where({ id }).update({ created_by: userId });
  },
};
