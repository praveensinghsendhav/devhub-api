import type {
  MeetingKind,
  MeetingMedia,
  MeetingRole,
  MeetingStatus,
  RsvpResponse,
} from '../shared/index.js';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { decryptField, encryptField } from '../common/utils/fieldEncryption.js';

export interface MeetingRow {
  id: string;
  organization_id: string | null;
  title: string;
  description: string | null;
  kind: MeetingKind;
  media: MeetingMedia;
  status: MeetingStatus;
  starts_at: Date;
  ends_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  allow_invites: boolean;
  mute_on_join: boolean;
  is_locked: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface MeetingParticipantRow {
  meeting_id: string;
  user_id: string;
  role: MeetingRole;
  rsvp: RsvpResponse;
  invited_by: string | null;
  removed_at: Date | null;
  created_at: Date;
}

export interface MeetingParticipantDetailRow extends MeetingParticipantRow {
  name: string;
  email: string;
  avatar_url: string | null;
}

type Executor = Knex | Knex.Transaction;

const MEETINGS = 'meetings';
const PARTICIPANTS = 'meeting_participants';

/** Rsvp states that put a meeting on someone's calendar. */
const ON_CALENDAR: RsvpResponse[] = ['accepted', 'tentative'];

/** `title` and `description` are encrypted at rest; this model is the only place that sees ciphertext. */
const encryptTitle = (value: string) => encryptField(value, 'meetings.title');
const encryptDescription = (value: string | null) =>
  value === null ? null : encryptField(value, 'meetings.description');

function decryptRow(row: MeetingRow): MeetingRow;
function decryptRow(row: MeetingRow | undefined): MeetingRow | undefined;
function decryptRow(row: MeetingRow | undefined): MeetingRow | undefined {
  if (!row) return row;
  return {
    ...row,
    title: decryptField(row.title, 'meetings.title'),
    description:
      row.description === null ? null : decryptField(row.description, 'meetings.description'),
  };
}

/** Meetings a user can see: invited (and not removed by a host). */
function visibleTo(userId: string, executor: Executor = db): Knex.QueryBuilder {
  return executor(`${MEETINGS} as m`)
    .join(`${PARTICIPANTS} as p`, 'p.meeting_id', 'm.id')
    .where('p.user_id', userId)
    .whereNull('p.removed_at')
    .select('m.*');
}

export const MeetingModel = {
  async findById(id: string, trx: Executor = db): Promise<MeetingRow | undefined> {
    return decryptRow(await trx<MeetingRow>(MEETINGS).where({ id }).first());
  },

  async findByIds(ids: string[]): Promise<MeetingRow[]> {
    if (ids.length === 0) return [];
    const rows: MeetingRow[] = await db<MeetingRow>(MEETINGS).whereIn('id', ids);
    return rows.map((row) => decryptRow(row));
  },

  /** Calendar view: meetings overlapping [from, to) that this user hosts or said yes/maybe to. */
  async listForCalendar(userId: string, from: Date, to: Date): Promise<MeetingRow[]> {
    const rows: MeetingRow[] = await visibleTo(userId)
      .whereIn('p.rsvp', ON_CALENDAR)
      .whereNot('m.status', 'cancelled')
      .where('m.starts_at', '<', to)
      .where('m.ends_at', '>', from)
      .orderBy('m.starts_at', 'asc')
      .limit(500);
    return rows.map((row) => decryptRow(row));
  },

  /** Live now, or scheduled and not over yet — on this user's calendar. */
  async listUpcoming(userId: string, limit: number): Promise<MeetingRow[]> {
    const rows: MeetingRow[] = await visibleTo(userId)
      .whereIn('p.rsvp', ON_CALENDAR)
      .where((q) =>
        q
          .where('m.status', 'live')
          .orWhere((s) => s.where('m.status', 'scheduled').where('m.ends_at', '>', db.fn.now())),
      )
      .orderBy('m.starts_at', 'asc')
      .limit(limit);
    return rows.map((row) => decryptRow(row));
  },

  /** Invitations still waiting on an answer, for meetings that haven't happened yet. */
  async listPendingInvitations(userId: string): Promise<MeetingRow[]> {
    const rows: MeetingRow[] = await visibleTo(userId)
      .where('p.rsvp', 'pending')
      .where((q) =>
        q
          .where('m.status', 'live')
          .orWhere((s) => s.where('m.status', 'scheduled').where('m.ends_at', '>', db.fn.now())),
      )
      .orderBy('m.starts_at', 'asc')
      .limit(100);
    return rows.map((row) => decryptRow(row));
  },

  async create(
    params: {
      organizationId: string | null;
      title: string;
      description: string | null;
      kind: MeetingKind;
      media: MeetingMedia;
      startsAt: Date;
      endsAt: Date;
      allowInvites: boolean;
      muteOnJoin: boolean;
      createdBy: string;
    },
    trx: Executor = db,
  ): Promise<MeetingRow> {
    const [row] = await trx<MeetingRow>(MEETINGS)
      .insert({
        organization_id: params.organizationId,
        title: encryptTitle(params.title),
        description: encryptDescription(params.description),
        kind: params.kind,
        media: params.media,
        status: 'scheduled',
        starts_at: params.startsAt,
        ends_at: params.endsAt,
        allow_invites: params.allowInvites,
        mute_on_join: params.muteOnJoin,
        created_by: params.createdBy,
      })
      .returning('*');
    return decryptRow(row as MeetingRow);
  },

  async update(
    id: string,
    changes: Partial<
      Pick<
        MeetingRow,
        | 'title'
        | 'description'
        | 'status'
        | 'starts_at'
        | 'ends_at'
        | 'started_at'
        | 'ended_at'
        | 'allow_invites'
        | 'mute_on_join'
        | 'is_locked'
      >
    >,
    trx: Executor = db,
  ): Promise<void> {
    const values: Record<string, unknown> = { ...changes, updated_at: trx.fn.now() };
    if (changes.title !== undefined) values.title = encryptTitle(changes.title);
    if (changes.description !== undefined) {
      values.description = encryptDescription(changes.description);
    }
    await trx(MEETINGS).where({ id }).update(values);
  },

  // ── Participants ─────────────────────────────────────────────────

  async getParticipants(meetingIds: string[]): Promise<MeetingParticipantDetailRow[]> {
    if (meetingIds.length === 0) return [];
    return db(`${PARTICIPANTS} as p`)
      .join('users as u', 'u.id', 'p.user_id')
      .whereIn('p.meeting_id', meetingIds)
      .whereNull('p.removed_at')
      .select('p.*', 'u.name', 'u.email', 'u.avatar_url')
      .orderBy([
        { column: 'p.created_at', order: 'asc' },
        { column: 'u.name', order: 'asc' },
      ]);
  },

  async getParticipant(
    meetingId: string,
    userId: string,
    trx: Executor = db,
  ): Promise<MeetingParticipantRow | undefined> {
    return trx<MeetingParticipantRow>(PARTICIPANTS)
      .where({ meeting_id: meetingId, user_id: userId })
      .first();
  },

  async listActiveParticipantIds(meetingId: string): Promise<string[]> {
    const rows = await db<MeetingParticipantRow>(PARTICIPANTS)
      .where({ meeting_id: meetingId })
      .whereNull('removed_at')
      .select('user_id');
    return rows.map((row) => row.user_id);
  },

  /**
   * Invites people. Anyone a host removed earlier is brought back (re-inviting is how a removal is
   * undone). Returns the ids that are newly invited.
   */
  async addParticipants(
    meetingId: string,
    participants: { userId: string; role: MeetingRole; rsvp: RsvpResponse }[],
    invitedBy: string,
    trx: Executor = db,
  ): Promise<string[]> {
    if (participants.length === 0) return [];
    const rows = await trx(PARTICIPANTS)
      .insert(
        participants.map((p) => ({
          meeting_id: meetingId,
          user_id: p.userId,
          role: p.role,
          rsvp: p.rsvp,
          invited_by: invitedBy,
        })),
      )
      .onConflict(['meeting_id', 'user_id'])
      .merge({ removed_at: null, rsvp: 'pending', invited_by: invitedBy })
      .whereNotNull(`${PARTICIPANTS}.removed_at`)
      .returning('user_id');
    return rows.map((row: { user_id: string }) => row.user_id);
  },

  async setRsvp(meetingId: string, userId: string, rsvp: RsvpResponse): Promise<void> {
    await db(PARTICIPANTS).where({ meeting_id: meetingId, user_id: userId }).update({ rsvp });
  },

  async setRole(meetingId: string, userId: string, role: MeetingRole): Promise<void> {
    await db(PARTICIPANTS).where({ meeting_id: meetingId, user_id: userId }).update({ role });
  },

  async markRemoved(meetingId: string, userId: string): Promise<void> {
    await db(PARTICIPANTS)
      .where({ meeting_id: meetingId, user_id: userId })
      .update({ removed_at: db.fn.now() });
  },
};
