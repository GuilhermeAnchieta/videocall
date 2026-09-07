import { Component, OnInit, inject, output, signal } from '@angular/core';
import { ClipLibraryService } from '../../services/clip-library.service';
import { MediaSourceService } from '../../services/media-source.service';
import { ClipInfo, MediaMode } from '../../models/room-state';

@Component({
  selector: 'app-media-switch-modal',
  standalone: true,
  templateUrl: './media-switch-modal.component.html',
  styleUrl: './media-switch-modal.component.scss'
})
export class MediaSwitchModalComponent implements OnInit {
  private readonly clipLibrary = inject(ClipLibraryService);
  private readonly mediaSource = inject(MediaSourceService);

  readonly close = output<void>();

  readonly mode = this.mediaSource.mode;
  readonly activeClip = this.mediaSource.activeClip;

  readonly clips = signal<ClipInfo[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const clips = await this.clipLibrary.listAvailableClips();
      this.clips.set(clips);
      clips.slice(0, 3).forEach((clip) => this.mediaSource.preloadClip(clip));
    } catch {
      this.errorMessage.set('Não foi possível carregar a biblioteca de clipes.');
    } finally {
      this.loading.set(false);
    }
  }

  isActiveClip(clip: ClipInfo, mode: MediaMode): boolean {
    return mode === 'clip' && this.activeClip()?.id === clip.id;
  }

  async chooseCamera(): Promise<void> {
    await this.mediaSource.switchToCamera();
    this.close.emit();
  }

  async chooseClip(clip: ClipInfo): Promise<void> {
    try {
      await this.mediaSource.switchToClip(clip);
      this.close.emit();
    } catch {
      this.errorMessage.set(`Não foi possível reproduzir "${clip.name}".`);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.uploading.set(true);
    this.errorMessage.set(null);
    try {
      const name = file.name.replace(/\.[^./]+$/, '');
      const clip = await this.clipLibrary.uploadPersonalClip(file, name);
      this.clips.update((list) => [...list, clip]);
    } catch {
      this.errorMessage.set('Falha ao enviar o clipe. Tente novamente.');
    } finally {
      this.uploading.set(false);
    }
  }

  formatDuration(seconds?: number): string {
    if (!seconds || !Number.isFinite(seconds)) return '';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
