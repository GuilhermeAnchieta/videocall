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
  audioContext?: AudioContext;
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
      isFake: true,
      fakeId: entry.id,
    })),
  );

  async add(roomCode: string, clip: ClipInfo, name: string): Promise<void> {
    // Create and resume the AudioContext as the very first thing, still inside the synchronous
    // call stack of the owner's click on the clips panel. Safari/WebKit (relevant here since the
    // app also ships via Capacitor) only honors resume() as "in response to a user gesture" when
    // it's invoked before any `await` breaks that call stack; every await below (token fetch, room
    // connect, video decode) would otherwise consume the gesture and leave the context permanently
    // 'suspended' — which produces silence on the published track for every participant, forever.
    const audioContext = new AudioContext();
    const audioContextResumed = audioContext.resume();

    const { token, livekitUrl } = await this.roomService.getAccessToken(
      roomCode,
      name,
    );

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: { simulcast: true, dtx: true, red: true },
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
    // Deliberately NOT muted. createMediaElementSource() below already reroutes this element's
    // entire audio output into the AudioContext graph — per spec, once that call is made, the
    // element itself can no longer be heard directly (its audio only reaches wherever the graph
    // is connected, which here is a MediaStreamDestination, never audioContext.destination). Muting
    // the element on top of that was redundant, and on some Chromium builds `muted` also zeroes out
    // the samples reaching the graph itself (the same effect this file previously hit with
    // captureStream()'s audio track) — silencing the published track for everyone, not just locally.
    videoEl.style.display = 'none';
    document.body.appendChild(videoEl);

    try {
      // Wired up before play() starts: createMediaElementSource() reroutes the element's audio
      // output into this graph, so connecting it first means playback never has a chance to reach
      // this device's speakers directly, not even for the single frame it'd otherwise take.
      await audioContextResumed;
      const source = audioContext.createMediaElementSource(videoEl);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      const audioMediaTrack = destination.stream.getAudioTracks()[0];

      // The audio track is sourced from this Web Audio graph rather than captureStream() (whose
      // audio track came back silent while videoEl was muted, before this used createMediaElementSource).
      await videoEl.play();
      const captured = videoEl.captureStream(30);
      const videoMediaTrack = captured.getVideoTracks()[0];

      const videoPublication = await room.localParticipant.publishTrack(
        videoMediaTrack,
        {
          source: Track.Source.Camera,
        },
      );
      const audioPublication = audioMediaTrack
        ? await room.localParticipant.publishTrack(audioMediaTrack, {
            source: Track.Source.Microphone,
          })
        : undefined;

      this.entries.update((list) => [
        ...list,
        {
          id,
          name,
          clip,
          room,
          videoEl,
          audioContext,
          videoTrack: videoPublication.track!,
          audioTrack: audioPublication?.track,
          cameraEnabled: true,
          micEnabled: true,
        },
      ]);
    } catch (err) {
      void audioContext?.close();
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

  /** Pauses only the given fake participants, ignoring any added after the snapshot of ids was taken. */
  freezeMany(ids: ReadonlySet<string>): void {
    this.entries()
      .filter((entry) => ids.has(entry.id))
      .forEach((entry) => entry.videoEl.pause());
  }

  /** Removes only the given fake participants — used by the teleport effect so a clip added
   * during the drop delay isn't swept away by a removal that was scheduled before it existed. */
  async removeMany(ids: ReadonlySet<string>): Promise<void> {
    const matching = this.entries().filter((entry) => ids.has(entry.id));
    await Promise.all(matching.map((entry) => this.remove(entry.id)));
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
    void entry.audioContext?.close();
  }

  async setMicEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) return;
    await entry.room.localParticipant.setMicrophoneEnabled(enabled);
    this.entries.update((list) =>
      list.map((e) => (e.id === id ? { ...e, micEnabled: enabled } : e)),
    );
  }

  async setCameraEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) return;
    await entry.room.localParticipant.setCameraEnabled(enabled);
    this.entries.update((list) =>
      list.map((e) => (e.id === id ? { ...e, cameraEnabled: enabled } : e)),
    );
  }

  dispose(): void {
    this.entries().forEach((entry) => {
      void entry.room.disconnect();
      entry.videoEl.pause();
      entry.videoEl.removeAttribute('src');
      entry.videoEl.load();
      entry.videoEl.remove();
      void entry.audioContext?.close();
    });
    this.entries.set([]);
  }
}
