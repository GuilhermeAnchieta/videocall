import type { Track } from 'livekit-client';

export type MediaMode = 'camera' | 'clip';

export interface ClipInfo {
  id: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  scope: 'shared' | 'personal';
  ownerId?: string;
}

export interface ParticipantView {
  identity: string;
  name: string;
  isLocal: boolean;
  videoTrack?: Track;
  audioTrack?: Track;
  cameraEnabled: boolean;
  micEnabled: boolean;
  isSpeaking: boolean;
  usingClip: boolean;
  /** "Bot" participant: a separate LiveKit connection publishing a clip, controlled by the room owner. */
  isFake: boolean;
  /** Internal id in FakeParticipantsService (present only when isFake is true). */
  fakeId?: string;
}

export interface ChatMessage {
  id: string;
  senderIdentity: string;
  senderName: string;
  text: string;
  timestamp: number;
  isLocal: boolean;
}

export interface JoinDetails {
  roomCode: string;
  displayName: string;
}
