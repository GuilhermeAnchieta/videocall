import { Component, ElementRef, computed, effect, inject, input, output, viewChild } from '@angular/core';
import { ParticipantView } from '../../models/room-state';
import { AudioOutputService } from '../../services/audio-output.service';

@Component({
  selector: 'app-video-tile',
  standalone: true,
  templateUrl: './video-tile.component.html',
  styleUrl: './video-tile.component.scss'
})
export class VideoTileComponent {
  private readonly audioOutput = inject(AudioOutputService);

  readonly participant = input.required<ParticipantView>();
  readonly isOwner = input<boolean>(false);
  readonly frozen = input<boolean>(false);

  readonly toggleFakeMic = output<void>();
  readonly toggleFakeCamera = output<void>();
  readonly removeFake = output<void>();

  private readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  readonly initials = computed(() => {
    const name = this.participant().name.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
    return (first + last).toUpperCase();
  });

  private readonly videoTrack = computed(() => this.participant().videoTrack);
  private readonly remoteAudioTrack = computed(() => (this.participant().isLocal ? undefined : this.participant().audioTrack));

  constructor() {
    effect((onCleanup) => {
      const track = this.videoTrack();
      const el = this.videoEl()?.nativeElement;
      if (track && el) {
        track.attach(el);
        onCleanup(() => track.detach(el));
      }
    });

    effect((onCleanup) => {
      const track = this.remoteAudioTrack();
      if (track) {
        const connection = this.audioOutput.connect(track);
        onCleanup(() => connection.disconnect());
      }
    });
  }
}
