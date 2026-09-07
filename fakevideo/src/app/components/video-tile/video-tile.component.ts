import { Component, ElementRef, computed, effect, input, viewChild } from '@angular/core';
import { ParticipantView } from '../../models/room-state';

@Component({
  selector: 'app-video-tile',
  standalone: true,
  templateUrl: './video-tile.component.html',
  styleUrl: './video-tile.component.scss'
})
export class VideoTileComponent {
  readonly participant = input.required<ParticipantView>();

  private readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');
  private readonly audioEl = viewChild<ElementRef<HTMLAudioElement>>('audioEl');

  readonly initials = computed(() => {
    const name = this.participant().name.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
    return (first + last).toUpperCase();
  });

  constructor() {
    effect((onCleanup) => {
      const track = this.participant().videoTrack;
      const el = this.videoEl()?.nativeElement;
      if (track && el) {
        track.attach(el);
        onCleanup(() => track.detach(el));
      }
    });

    effect((onCleanup) => {
      const p = this.participant();
      const track = p.audioTrack;
      const el = this.audioEl()?.nativeElement;
      if (!p.isLocal && track && el) {
        track.attach(el);
        onCleanup(() => track.detach(el));
      }
    });
  }
}
