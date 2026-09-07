import { Injectable, signal } from '@angular/core';
import { LocalTrack } from 'livekit-client';
import { ClipInfo, MediaMode } from '../models/room-state';
import { LivekitService } from './livekit.service';

@Injectable({ providedIn: 'root' })
export class MediaSourceService {
  readonly mode = signal<MediaMode>('camera');
  readonly activeClip = signal<ClipInfo | null>(null);

  private readonly clipElements = new Map<string, HTMLVideoElement>();
  private activeClipElement: HTMLVideoElement | null = null;

  constructor(private readonly livekit: LivekitService) {}

  /** Creates (or reuses) a hidden looping <video> for a clip so playback can start instantly. */
  preloadClip(clip: ClipInfo): HTMLVideoElement {
    let el = this.clipElements.get(clip.id);
    if (!el) {
      el = document.createElement('video');
      el.src = clip.url;
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.muted = false; // must stay unmuted so captureStream() carries an audio track
      el.style.display = 'none';
      document.body.appendChild(el);
      this.clipElements.set(clip.id, el);
    }
    return el;
  }

  async switchToCamera(): Promise<void> {
    if (this.mode() === 'camera') return;

    const { video: videoTrack, audio: audioTrack } = await this.ensurePublications();
    const oldVideo = videoTrack?.mediaStreamTrack;
    const oldAudio = audioTrack?.mediaStreamTrack;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const newVideo = stream.getVideoTracks()[0];
    const newAudio = stream.getAudioTracks()[0];

    if (videoTrack && newVideo) await videoTrack.replaceTrack(newVideo);
    if (audioTrack && newAudio) await audioTrack.replaceTrack(newAudio);

    this.stopIfUnused(oldVideo, newVideo);
    this.stopIfUnused(oldAudio, newAudio);
    this.pauseActiveClip();

    this.mode.set('camera');
    this.activeClip.set(null);
    this.livekit.refresh();
  }

  async switchToClip(clip: ClipInfo): Promise<void> {
    const el = this.preloadClip(clip);
    el.currentTime = 0;
    await el.play();
    const captured = el.captureStream(30);

    const { video: videoTrack, audio: audioTrack } = await this.ensurePublications();
    const oldVideo = videoTrack?.mediaStreamTrack;
    const oldAudio = audioTrack?.mediaStreamTrack;

    const newVideo = captured.getVideoTracks()[0];
    const newAudio = captured.getAudioTracks()[0];

    if (videoTrack && newVideo) await videoTrack.replaceTrack(newVideo);
    if (audioTrack && newAudio) await audioTrack.replaceTrack(newAudio);

    this.stopIfUnused(oldVideo, newVideo);
    this.stopIfUnused(oldAudio, newAudio);
    this.pauseActiveClip(el);
    this.activeClipElement = el;

    this.mode.set('clip');
    this.activeClip.set(clip);
    this.livekit.refresh();
  }

  dispose(): void {
    this.clipElements.forEach((el) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    });
    this.clipElements.clear();
    this.activeClipElement = null;
  }

  private pauseActiveClip(except?: HTMLVideoElement): void {
    if (this.activeClipElement && this.activeClipElement !== except) {
      this.activeClipElement.pause();
    }
    if (!except) {
      this.activeClipElement = null;
    }
  }

  private stopIfUnused(oldTrack: MediaStreamTrack | undefined, newTrack: MediaStreamTrack | undefined): void {
    if (oldTrack && oldTrack !== newTrack) {
      oldTrack.stop();
    }
  }

  /** The clip swap only works once camera/mic are published; turn them on if the user had muted them. */
  private async ensurePublications(): Promise<{ video?: LocalTrack; audio?: LocalTrack }> {
    if (!this.livekit.getLocalVideoTrack()) {
      await this.livekit.setCameraEnabled(true);
    }
    if (!this.livekit.getLocalAudioTrack()) {
      await this.livekit.setMicEnabled(true);
    }
    return { video: this.livekit.getLocalVideoTrack(), audio: this.livekit.getLocalAudioTrack() };
  }
}
