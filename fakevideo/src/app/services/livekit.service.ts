import { Injectable, signal } from '@angular/core';
import {
  LocalParticipant,
  LocalTrack,
  Participant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from 'livekit-client';
import { ChatMessage, ParticipantView } from '../models/room-state';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

@Injectable({ providedIn: 'root' })
export class LivekitService {
  private room: Room | null = null;

  readonly participants = signal<ParticipantView[]>([]);
  readonly chatMessages = signal<ChatMessage[]>([]);
  readonly connectionState = signal<ConnectionState>('disconnected');
  /** Bumped (never read for its value) whenever a teleport effect should play, be it locally triggered or received from the host. */
  readonly teleportPulse = signal(0);

  get localParticipant(): LocalParticipant | undefined {
    return this.room?.localParticipant;
  }

  async connect(
    url: string,
    token: string,
    options: { micEnabled?: boolean; cameraEnabled?: boolean } = {},
  ): Promise<void> {
    const { micEnabled = true, cameraEnabled = true } = options;
    this.connectionState.set('connecting');
    // teleportPulse is a service-wide signal that outlives a single call — reset it so a
    // teleport played in a previous room doesn't replay itself the instant this one mounts.
    this.teleportPulse.set(0);
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
        facingMode: 'user',
      },
      publishDefaults: {
        videoEncoding: VideoPresets.h720.encoding,
        simulcast: true,
        dtx: true,
        red: true,
      },
    });
    this.room = room;
    this.bindEvents(room);

    // Joining the room (signaling) is kept separate from acquiring the camera/mic: a
    // getUserMedia() call that hangs (e.g. camera disabled/blocked at the OS level on some
    // browsers) must not leave the "joining" screen stuck forever once the room itself connected.
    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    await room.localParticipant.setCameraEnabled(true);

    this.connectionState.set('connected');
    this.sync();

    await Promise.allSettled([
      micEnabled ? room.localParticipant.setMicrophoneEnabled(true) : undefined,
      cameraEnabled ? room.localParticipant.setCameraEnabled(true) : undefined,
    ]);
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

  getActiveMicrophoneId(): string | undefined {
    return this.room?.getActiveDevice('audioinput');
  }

  async switchMicrophone(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice('audioinput', deviceId);
    this.sync();
  }

  getActiveCameraId(): string | undefined {
    return this.room?.getActiveDevice('videoinput');
  }

  async switchCamera(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice('videoinput', deviceId);
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
      isLocal: true,
    };
    this.chatMessages.update((list) => [...list, message]);

    const payload = new TextEncoder().encode(JSON.stringify(message));
    void local.publishData(payload, { reliable: true, topic: 'chat' });
  }

  /** Plays the teleport effect locally and broadcasts it so every other participant plays it too. */
  triggerTeleportEffect(): void {
    this.teleportPulse.update((n) => n + 1);
    const local = this.room?.localParticipant;
    if (!local) return;
    void local.publishData(new TextEncoder().encode('teleport'), {
      reliable: true,
      topic: 'teleport',
    });
  }

  getLocalVideoTrack(): LocalTrack | undefined {
    return this.room?.localParticipant.getTrackPublication(Track.Source.Camera)
      ?.track;
  }

  getLocalAudioTrack(): LocalTrack | undefined {
    return this.room?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
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
        if (topic === 'teleport') {
          this.teleportPulse.update((n) => n + 1);
          return;
        }
        if (topic !== 'chat') return;
        try {
          const message = JSON.parse(
            new TextDecoder().decode(payload),
          ) as ChatMessage;
          this.chatMessages.update((list) => [
            ...list,
            { ...message, isLocal: false },
          ]);
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
    room.remoteParticipants.forEach((participant) =>
      list.push(this.toView(participant, false)),
    );
    this.participants.set(list);
  }

  private toView(participant: Participant, isLocal: boolean): ParticipantView {
    const cameraPublication = participant.getTrackPublication(
      Track.Source.Camera,
    );
    const microphonePublication = participant.getTrackPublication(
      Track.Source.Microphone,
    );
    return {
      identity: participant.identity,
      name: participant.name || participant.identity,
      isLocal,
      videoTrack: cameraPublication?.track,
      audioTrack: microphonePublication?.track,
      cameraEnabled: participant.isCameraEnabled,
      micEnabled: participant.isMicrophoneEnabled,
      isSpeaking: participant.isSpeaking,
      isFake: false,
    };
  }
}
