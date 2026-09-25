import type { Knex } from 'knex';
import { db } from '../knex.js';
import type { PaginatedResult, PaginationMeta } from '../../shared/index.js';
import { AppError } from '../../common/errors/AppError.js';
import { ERROR_CODES } from '../../common/constants/errorCodes.js';
import { HTTP_STATUS } from '../../common/constants/httpStatus.js';

/**
 * Reusable Knex helpers that don't exist on the query builder out of the box.
 * Models compose these instead of re-implementing pagination/upsert/etc. per table.
 */
export const queryFactory = {
  /** Offset-based pagination with a single extra `count` query. */
  async paginate<T>(
    baseQuery: Knex.QueryBuilder,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<T>> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 100);

    const countQuery = baseQuery.clone().clearSelect().clearOrder().count<{ count: string }[]>({
      count: '*',
    });
    const countRows = await countQuery;
    const total = Number(countRows[0]?.count ?? 0);

    const items = await baseQuery
      .clone()
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize);

    const pagination: PaginationMeta = {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };

    return { items: items as T[], pagination };
  },

  /** Insert or update on unique-constraint conflict, returning the row. */
  async upsert<T>(
    table: string,
    values: Record<string, unknown>,
    conflictColumns: string[],
    mergeColumns: string[],
    trx: Knex.Transaction | Knex = db,
  ): Promise<T> {
    const [row] = await trx(table)
      .insert(values)
      .onConflict(conflictColumns)
      .merge(mergeColumns)
      .returning('*');
    return row as T;
  },

  /** Fetch a single row or raise a consistent 404 AppError. */
  async findOneOrThrow<T>(query: Knex.QueryBuilder, notFoundMessage: string): Promise<T> {
    const row = await query.first();
    if (!row) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, notFoundMessage);
    }
    return row as T;
  },

  async exists(query: Knex.QueryBuilder): Promise<boolean> {
    const row = await query.first();
    return Boolean(row);
  },

  async withTransaction<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return db.transaction(work);
  },
};
