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
    console.log('[fake] add() starting, id=', id, 'name=', name);
    room.once(RoomEvent.Disconnected, () => {
      console.log('[fake] Disconnected event, removing from entries, id=', id);
      this.entries.update((list) => list.filter((entry) => entry.id !== id));
    });

    await room.connect(livekitUrl, token);

    const videoEl = document.createElement('video');
    videoEl.src = clip.url;
    videoEl.loop = true;
    videoEl.preload = 'auto';
    videoEl.crossOrigin = 'anonymous';
    // Always muted: this element exists only to feed captureStream()'s video track and, via the
    // AudioContext graph below, the published audio track. It must never be heard directly out of
    // this device's speakers — whoever added the clip already hears the fake participant through
    // the normal remote-audio path (AudioOutputService), which does respect the mic mute state.
    videoEl.muted = true;
    videoEl.style.display = 'none';
    document.body.appendChild(videoEl);

    let audioContext: AudioContext | undefined;
    try {
      await videoEl.play();
      const captured = videoEl.captureStream(30);
      const videoMediaTrack = captured.getVideoTracks()[0];

      // The audio track is sourced from a Web Audio graph instead of captureStream(), and that
      // graph is never connected to audioContext.destination — so this decouples the published
      // track from local playback entirely, instead of relying on videoEl.muted (which, on some
      // browsers, silences captureStream()'s audio too when the element itself is muted).
      audioContext = new AudioContext();
      // Browsers create AudioContext in a 'suspended' state unless a user gesture is already in
      // progress; while suspended, the graph produces silence, which would mute the published
      // track for everyone even though the fake participant is "on". add() is always called from
      // the owner's click on the clips panel, so a gesture is available to resume it.
      await audioContext.resume();
      const source = audioContext.createMediaElementSource(videoEl);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      const audioMediaTrack = destination.stream.getAudioTracks()[0];

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
      console.log(
        '[fake] add() succeeded, id=',
        id,
        'entries now=',
        this.entries().map((e) => e.id),
      );
    } catch (err) {
      console.log('[fake] add() failed, id=', id, err);
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
    console.log(
      '[fake] removeMany called with ids=',
      [...ids],
      'current entries=',
      this.entries().map((e) => e.id),
      'matching to remove=',
      matching.map((e) => e.id),
    );
    await Promise.all(matching.map((entry) => this.remove(entry.id)));
  }

  async remove(id: string): Promise<void> {
    console.trace('[fake] remove() called for id=', id);
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
