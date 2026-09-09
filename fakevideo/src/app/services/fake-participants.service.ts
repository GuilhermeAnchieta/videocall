import { Injectable, computed, inject, signal } from '@angular/core';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { LocalTrack } from 'livekit-client';
import { ClipInfo, ParticipantView } from '../models/room-state';
import { RoomService } from './room.service';

interface FakeParticipant {
  id: string;
  name: string;
  clip: ClipInfo;
  room: Room;
  videoEl: HTMLVideoElement;
  videoTrack: LocalTrack;
  audioTrack?: LocalTrack;
  cameraEnabled: boolean;
  micEnabled: boolean;
}

/**
 * Each "fake participant" is its own LiveKit connection (dedicated identity and Room)
 * publishing the video/audio captured from a clip — that's why it shows up to other
 * real participants as an actual extra person in the call, not just a visual marker
 * on the owner's side.
 */
@Injectable({ providedIn: 'root' })
export class FakeParticipantsService {
  private readonly roomService = inject(RoomService);

  private readonly entries = signal<FakeParticipant[]>([]);

  readonly participantViews = computed<ParticipantView[]>(() =>
    this.entries().map((entry) => ({
      identity: entry.room.localParticipant.identity,
      name: entry.name,
      isLocal: false,
      videoTrack: entry.videoTrack,
      audioTrack: entry.audioTrack,
      cameraEnabled: entry.cameraEnabled,
      micEnabled: entry.micEnabled,
      isSpeaking: false,
      usingClip: false,
      isFake: true,
      fakeId: entry.id
    }))
  );

  async add(roomCode: string, clip: ClipInfo, name: string): Promise<void> {
    const { token, livekitUrl } = await this.roomService.getAccessToken(roomCode, name);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: { simulcast: true, dtx: true, red: true }
    });

    const id = crypto.randomUUID();
    room.once(RoomEvent.Disconnected, () => {
      this.entries.update((list) => list.filter((entry) => entry.id !== id));
    });

    await room.connect(livekitUrl, token);

    const videoEl = document.createElement('video');
    videoEl.src = clip.url;
    videoEl.loop = true;
    videoEl.preload = 'auto';
    videoEl.crossOrigin = 'anonymous';
    videoEl.muted = false; // must stay unmuted for captureStream() to carry audio
    videoEl.style.display = 'none';
    document.body.appendChild(videoEl);

    try {
      await videoEl.play();
      const captured = videoEl.captureStream(30);
      const videoMediaTrack = captured.getVideoTracks()[0];
      const audioMediaTrack = captured.getAudioTracks()[0];

      const videoPublication = await room.localParticipant.publishTrack(videoMediaTrack, {
        source: Track.Source.Camera
      });
      const audioPublication = audioMediaTrack
        ? await room.localParticipant.publishTrack(audioMediaTrack, { source: Track.Source.Microphone })
        : undefined;

      this.entries.update((list) => [
        ...list,
        {
          id,
          name,
          clip,
          room,
          videoEl,
          videoTrack: videoPublication.track!,
          audioTrack: audioPublication?.track,
          cameraEnabled: true,
          micEnabled: true
        }
      ]);
    } catch (err) {
      videoEl.remove();
      await room.disconnect();
      throw err;
    }
  }

  /** Pauses each clip's video element so its frame freezes for every viewer (the underlying track keeps publishing the stalled frame). */
  freezeAll(): void {
    this.entries().forEach((entry) => entry.videoEl.pause());
  }

  async removeAll(): Promise<void> {
    await Promise.all(this.entries().map((entry) => this.remove(entry.id)));
  }

  async remove(id: string): Promise<void> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) return;

    this.entries.update((list) => list.filter((e) => e.id !== id));
    await entry.room.disconnect();
    entry.videoEl.pause();
    entry.videoEl.removeAttribute('src');
    entry.videoEl.load();
    entry.videoEl.remove();
  }

  async setMicEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) return;
    await entry.room.localParticipant.setMicrophoneEnabled(enabled);
    this.entries.update((list) => list.map((e) => (e.id === id ? { ...e, micEnabled: enabled } : e)));
  }

  async setCameraEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) return;
    await entry.room.localParticipant.setCameraEnabled(enabled);
    this.entries.update((list) => list.map((e) => (e.id === id ? { ...e, cameraEnabled: enabled } : e)));
  }

  dispose(): void {
    this.entries().forEach((entry) => {
      void entry.room.disconnect();
      entry.videoEl.pause();
      entry.videoEl.removeAttribute('src');
      entry.videoEl.load();
      entry.videoEl.remove();
    });
    this.entries.set([]);
  }
}
