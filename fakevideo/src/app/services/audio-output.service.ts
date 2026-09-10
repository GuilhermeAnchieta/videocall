import { Injectable, signal } from '@angular/core';
import type { Track } from 'livekit-client';

type SinkCapableElement = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

const SINK_ID_SUPPORTED =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Plays remote audio (real and fake participants) and allows choosing the output device
 * (speaker/headphones). Remote tracks are attached to the <audio> element directly, without
 * routing them through a Web Audio graph first: Chrome/Android's native echo cancellation
 * (echoCancellation: true, set on local capture) can only use the audio actually rendered to
 * the output device as its reference signal, and a stream re-synthesized via
 * AudioContext.createMediaStreamDestination() isn't reliably recognized as that reference.
 * Routing playback through Web Audio here previously broke AEC on whichever device didn't use
 * headphones, so its mic picked its own speaker output back up (including the other person's
 * voice) and re-sent it into the call, causing a growing feedback squeal. Plain <audio>
 * playback is the path AEC is actually built around.
 */
@Injectable({ providedIn: 'root' })
export class AudioOutputService {
  private outputDeviceId?: string;
  private readonly liveElements = new Set<SinkCapableElement>();
  private unlockListenersAttached = false;

  readonly sinkIdSupported = SINK_ID_SUPPORTED;
  readonly outputDevice = signal<string | undefined>(undefined);
  /** True when a remote track's playback was rejected by the browser's autoplay policy and is
   *  waiting on a user gesture to retry. The UI should surface a visible "tap to enable audio"
   *  prompt instead of relying on the user to stumble into an unrelated click/tap. */
  readonly playbackBlocked = signal(false);

  constructor() {
    // Attach the unlock listeners immediately instead of waiting for the first remote track:
    // the host typically creates the room and sits idle until someone joins, so by the time a
    // remote track arrives there may be no user gesture left to resume playback on. Listening
    // from the start means whatever the host clicked/tapped earlier (e.g. "Create room") already
    // counts.
    this.ensureUnlockListeners();
  }

  /**
   * The <audio> elements fed by remote tracks are created asynchronously once a remote track
   * arrives, not synchronously inside a click handler, so browsers routinely start them
   * suspended/blocked. Retry on the next real user gesture instead of staying silent forever.
   */
  private ensureUnlockListeners(): void {
    if (this.unlockListenersAttached) return;
    this.unlockListenersAttached = true;
    (['pointerdown', 'touchend', 'keydown'] as const).forEach((evt) =>
      document.addEventListener(evt, this.retryPlayback, { passive: true })
    );
  }

  /**
   * Re-plays every remote <audio> element. Runs automatically on the next click/tap/key press
   * (see ensureUnlockListeners), but is also exposed so a visible "tap to enable audio" prompt
   * can call it directly from its own click handler instead of relying on the user to stumble
   * into an unrelated gesture first.
   */
  readonly retryPlayback = (): void => {
    Promise.all([...this.liveElements].map((el) => el.play().catch(() => false))).then((results) => {
      if (results.every((r) => r !== false)) this.playbackBlocked.set(false);
    });
  };

  /** Plays a remote participant's audio; returns how to disconnect. */
  connect(track: Track): { disconnect(): void } {
    const audioEl: SinkCapableElement = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = new MediaStream([track.mediaStreamTrack]);
    // Keep it in the DOM (hidden — audio elements without `controls` render as nothing anyway):
    // some browsers (notably Safari/iOS) are unreliable about continuing to play detached media
    // elements, and being attached also makes it eligible for the page's autoplay allowance.
    document.body.appendChild(audioEl);
    if (this.outputDeviceId && this.sinkIdSupported) {
      void audioEl.setSinkId?.(this.outputDeviceId).catch(() => {});
    }
    // autoplay alone can silently no-op if the browser blocks it; play() explicitly so a
    // rejection is at least retryable from ensureUnlockListeners() on the next user gesture.
    void audioEl.play().catch((err) => {
      console.warn(
        '[AudioOutputService] playback blocked for a remote track; ' +
          'will retry on next user interaction (click/tap/key press).',
        err
      );
      this.playbackBlocked.set(true);
    });
    this.liveElements.add(audioEl);

    return {
      disconnect: () => {
        this.liveElements.delete(audioEl);
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      }
    };
  }

  /** Switches the speaker/headphones used to play all remote audio already connected (and future). */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    this.outputDevice.set(deviceId);
    if (!this.sinkIdSupported) return;
    await Promise.all([...this.liveElements].map((el) => el.setSinkId?.(deviceId).catch(() => {})));
  }
}
