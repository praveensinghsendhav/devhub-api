/**
 * Meetings: 1:1 and group calls, instant or scheduled. Media is peer-to-peer WebRTC (mesh), so
 * calls are capped — past this size every browser would be uploading too many streams.
 */
export const MAX_MEETING_PARTICIPANTS = 12;

/** People on the invite list (not everyone invited joins, so this can exceed the live cap). */
export const MAX_MEETING_INVITEES = 50;

export const MEETING_KINDS = ['instant', 'scheduled'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_STATUSES = ['scheduled', 'live', 'ended', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_MEDIA = ['video', 'audio'] as const;
export type MeetingMedia = (typeof MEETING_MEDIA)[number];

export const MEETING_ROLES = ['host', 'cohost', 'participant'] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];

/** Only accepted/tentative meetings appear on a person's calendar. */
export const RSVP_RESPONSES = ['pending', 'accepted', 'tentative', 'declined'] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

export const MEETING_REACTIONS = ['👍', '👏', '😂', '🎉', '❤️', '😮'] as const;
export type MeetingReaction = (typeof MEETING_REACTIONS)[number];

export const MEETING_CHAT_MAX_LENGTH = 1000;

export interface MeetingParticipant {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: MeetingRole;
  rsvp: RsvpResponse;
  invitedBy: string | null;
}

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  kind: MeetingKind;
  media: MeetingMedia;
  status: MeetingStatus;
  startsAt: string;
  endsAt: string;
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string;
  allowInvites: boolean;
  muteOnJoin: boolean;
  isLocked: boolean;
  participants: MeetingParticipant[];
  myRole: MeetingRole;
  myRsvp: RsvpResponse;
  /** True when you can add people: hosts always, everyone else when the host allows it. */
  canInvite: boolean;
  createdAt: string;
}

export interface CreateMeetingRequest {
  title: string;
  description?: string;
  kind: MeetingKind;
  media?: MeetingMedia;
  /** Required for scheduled meetings; instant meetings start now. */
  startsAt?: string;
  durationMinutes?: number;
  inviteeIds: string[];
  allowInvites?: boolean;
  muteOnJoin?: boolean;
}

export interface UpdateMeetingRequest {
  title?: string;
  description?: string | null;
  startsAt?: string;
  durationMinutes?: number;
  allowInvites?: boolean;
  muteOnJoin?: boolean;
}

export interface RsvpRequest {
  response: Exclude<RsvpResponse, 'pending'>;
}

/** A broadcast message, shown on the calendar on the day it was posted. */
export interface Announcement {
  id: string;
  conversationId: string;
  conversationName: string;
  senderName: string;
  body: string;
  createdAt: string;
}

// ── Realtime: live room ────────────────────────────────────────────

export type ConnectionQuality = 'good' | 'fair' | 'poor';

/** What everyone else sees about you in a call. */
export interface PeerMediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
  quality: ConnectionQuality;
}

/** One connected device in a call (a person on two devices is two peers). */
export interface MeetingPeer {
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: MeetingRole;
  state: PeerMediaState;
  joinedAt: string;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface MeetingJoinRequest {
  meetingId: string;
  state: Pick<PeerMediaState, 'audio' | 'video'>;
}

export type MeetingJoinErrorCode =
  'not_found' | 'ended' | 'locked' | 'full' | 'removed' | 'cancelled';

export type MeetingJoinResponse =
  | {
      ok: true;
      selfPeerId: string;
      peers: MeetingPeer[];
      iceServers: IceServerConfig[];
      meeting: Pick<Meeting, 'id' | 'title' | 'isLocked' | 'muteOnJoin' | 'myRole' | 'media'>;
    }
  | { ok: false; code: MeetingJoinErrorCode; message: string };

/** SDP or ICE, or a "send me at most this quality" preference — relayed peer to peer. */
export interface SignalData {
  description?: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string };
  candidate?: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  } | null;
  /** Receiver's preferred video quality from this sender. */
  videoPref?: 'high' | 'low' | 'off';
}

export interface MeetingSignalRequest {
  meetingId: string;
  to: string;
  data: SignalData;
}

export interface MeetingSignalPayload {
  meetingId: string;
  from: string;
  data: SignalData;
}

export interface MeetingPeerLeftPayload {
  meetingId: string;
  peerId: string;
}

export interface MeetingPeerUpdatedPayload {
  meetingId: string;
  peer: MeetingPeer;
}

export interface MeetingChatMessage {
  id: string;
  meetingId: string;
  peerId: string;
  userId: string;
  name: string;
  text: string;
  sentAt: string;
}

export interface MeetingReactionPayload {
  meetingId: string;
  peerId: string;
  name: string;
  emoji: MeetingReaction;
}

export const HOST_ACTIONS = [
  'mute',
  'camera-off',
  'lower-hand',
  'remove',
  'make-cohost',
  'remove-cohost',
  'mute-all',
  'lock',
  'unlock',
  'end',
] as const;
export type HostAction = (typeof HOST_ACTIONS)[number];

export interface MeetingHostActionRequest {
  meetingId: string;
  action: HostAction;
  /** Required for actions aimed at one person. */
  peerId?: string;
}

/** Sent to the target peer: "the host asked you to…". Only ever turns things off. */
export interface MeetingHostCommandPayload {
  meetingId: string;
  command: 'mute' | 'camera-off' | 'lower-hand';
  byName: string;
}

export interface MeetingRoomStatePayload {
  meetingId: string;
  isLocked: boolean;
}

export interface MeetingKnockPayload {
  meetingId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface MeetingAdmitRequest {
  meetingId: string;
  userId: string;
  allow: boolean;
}

export interface MeetingAdmittedPayload {
  meetingId: string;
  allow: boolean;
}

export interface MeetingRingPayload {
  meetingId: string;
  title: string;
  media: MeetingMedia;
  from: { id: string; name: string; avatarUrl: string | null };
  /** How many people were invited, so the ring can say "group call". */
  inviteeCount: number;
}

export interface MeetingDeclinedPayload {
  meetingId: string;
  userId: string;
  name: string;
}

export interface MeetingEventPayload {
  meetingId: string;
}

export interface MeetingRemovedPayload {
  meetingId: string;
  reason: 'removed' | 'ended';
}

/** Generic socket ack for requests that can fail. */
export type SocketAck = { ok: true } | { ok: false; message: string };
