import { Injectable, signal } from '@angular/core';
import { LocalParticipant, LocalTrack, Participant, Room, RoomEvent, Track } from 'livekit-client';
import { ChatMessage, ParticipantView } from '../models/room-state';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

@Injectable({ providedIn: 'root' })
export class LivekitService {
  private room: Room | null = null;

  readonly participants = signal<ParticipantView[]>([]);
  readonly chatMessages = signal<ChatMessage[]>([]);
  readonly connectionState = signal<ConnectionState>('disconnected');

  get localParticipant(): LocalParticipant | undefined {
    return this.room?.localParticipant;
  }

  async connect(url: string, token: string): Promise<void> {
    this.connectionState.set('connecting');
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    this.bindEvents(room);

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    await room.localParticipant.setCameraEnabled(true);

    this.connectionState.set('connected');
    this.sync();
  }

  async disconnect(): Promise<void> {
    await this.room?.disconnect();
    this.room = null;
    this.participants.set([]);
    this.chatMessages.set([]);
    this.connectionState.set('disconnected');
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(enabled);
    this.sync();
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setCameraEnabled(enabled);
    this.sync();
  }

  sendChatMessage(text: string): void {
    const local = this.room?.localParticipant;
    const trimmed = text.trim();
    if (!local || !trimmed) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      senderIdentity: local.identity,
      senderName: local.name || local.identity,
      text: trimmed,
      timestamp: Date.now(),
      isLocal: true
    };
    this.chatMessages.update((list) => [...list, message]);

    const payload = new TextEncoder().encode(JSON.stringify(message));
    void local.publishData(payload, { reliable: true, topic: 'chat' });
  }

  getLocalVideoTrack(): LocalTrack | undefined {
    return this.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  }

  getLocalAudioTrack(): LocalTrack | undefined {
    return this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  }

  /** Refresh derived participant state after a track swap that doesn't go through publish/unpublish events. */
  refresh(): void {
    this.sync();
  }

  private bindEvents(room: Room): void {
    const resync = () => this.sync();
    room
      .on(RoomEvent.ParticipantConnected, resync)
      .on(RoomEvent.ParticipantDisconnected, resync)
      .on(RoomEvent.TrackSubscribed, resync)
      .on(RoomEvent.TrackUnsubscribed, resync)
      .on(RoomEvent.TrackMuted, resync)
      .on(RoomEvent.TrackUnmuted, resync)
      .on(RoomEvent.LocalTrackPublished, resync)
      .on(RoomEvent.LocalTrackUnpublished, resync)
      .on(RoomEvent.ActiveSpeakersChanged, resync)
      .on(RoomEvent.Disconnected, () => {
        this.participants.set([]);
        this.connectionState.set('disconnected');
      })
      .on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== 'chat') return;
        try {
          const message = JSON.parse(new TextDecoder().decode(payload)) as ChatMessage;
          this.chatMessages.update((list) => [...list, { ...message, isLocal: false }]);
        } catch {
          // ignore malformed chat payloads
        }
      });
  }

  private sync(): void {
    const room = this.room;
    if (!room) {
      this.participants.set([]);
      return;
    }
    const list: ParticipantView[] = [this.toView(room.localParticipant, true)];
    room.remoteParticipants.forEach((participant) => list.push(this.toView(participant, false)));
    this.participants.set(list);
  }

  private toView(participant: Participant, isLocal: boolean): ParticipantView {
    const cameraPublication = participant.getTrackPublication(Track.Source.Camera);
    const microphonePublication = participant.getTrackPublication(Track.Source.Microphone);
    return {
      identity: participant.identity,
      name: participant.name || participant.identity,
      isLocal,
      videoTrack: cameraPublication?.track,
      audioTrack: microphonePublication?.track,
      cameraEnabled: participant.isCameraEnabled,
      micEnabled: participant.isMicrophoneEnabled,
      isSpeaking: participant.isSpeaking,
      usingClip: false
    };
  }
}
