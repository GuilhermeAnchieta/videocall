import { Injectable, signal } from '@angular/core';
import type { Track } from 'livekit-client';

type SinkCapableElement = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

const SINK_ID_SUPPORTED =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Plays remote audio (real and fake participants) through a compressor/limiter instead
 * of a raw <audio> element, and allows choosing the output device (speaker/headphones).
 * This doesn't fix acoustic echo between two physical devices nearby (that's a
 * microphone-pickup problem, not a software one — use headphones when testing with
 * two devices in the same room), but it keeps volume spikes and harsh/clipped
 * artifacts from coming through untreated, and lets you choose where the sound goes.
 */
@Injectable({ providedIn: 'root' })
export class AudioOutputService {
  private context?: AudioContext;
  private outputDeviceId?: string;
  private readonly liveElements = new Set<SinkCapableElement>();

  readonly sinkIdSupported = SINK_ID_SUPPORTED;
  readonly outputDevice = signal<string | undefined>(undefined);

  private getContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
    return this.context;
  }

  /** Connects a remote participant's audio to a gentle limiter; returns how to disconnect. */
  connect(track: Track): { disconnect(): void } {
    const ctx = this.getContext();
    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = ctx.createMediaStreamSource(stream);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // Cuts a bit of excess treble (feedback/artifacts from captureStream video compression).
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 6000;
    highShelf.gain.value = -6;

    // Outputs through an <audio> element (instead of ctx.destination) just so we can choose
    // the output device via setSinkId — plain Web Audio doesn't allow picking the speaker.
    const destinationNode = ctx.createMediaStreamDestination();
    source.connect(compressor).connect(highShelf).connect(destinationNode);

    const audioEl: SinkCapableElement = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = destinationNode.stream;
    if (this.outputDeviceId && this.sinkIdSupported) {
      void audioEl.setSinkId?.(this.outputDeviceId).catch(() => {});
    }
    this.liveElements.add(audioEl);

    return {
      disconnect: () => {
        this.liveElements.delete(audioEl);
        audioEl.pause();
        audioEl.srcObject = null;
        source.disconnect();
        compressor.disconnect();
        highShelf.disconnect();
        destinationNode.disconnect();
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
