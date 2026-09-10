import { Injectable } from '@angular/core';
import { ClipInfo } from '../models/room-state';

@Injectable({ providedIn: 'root' })
export class MediaSourceService {
  private readonly clipElements = new Map<string, HTMLVideoElement>();

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

  dispose(): void {
    this.clipElements.forEach((el) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    });
    this.clipElements.clear();
  }
}
