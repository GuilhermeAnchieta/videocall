import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClipLibraryService } from '../../services/clip-library.service';
import { MediaSourceService } from '../../services/media-source.service';
import { FakeParticipantsService } from '../../services/fake-participants.service';
import { ClipInfo } from '../../models/room-state';

@Component({
  selector: 'app-clips-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './clips-panel.component.html',
  styleUrl: './clips-panel.component.scss'
})
export class ClipsPanelComponent implements OnInit {
  private readonly clipLibrary = inject(ClipLibraryService);
  private readonly mediaSource = inject(MediaSourceService);
  private readonly fakeParticipants = inject(FakeParticipantsService);

  readonly roomCode = input.required<string>();
  readonly close = output<void>();

  readonly fakeList = this.fakeParticipants.participantViews;

  readonly clips = signal<ClipInfo[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly newFakeName = signal('');
  readonly addingFakeClipId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const clips = await this.clipLibrary.listAvailableClips();
      this.clips.set(clips);
      clips.slice(0, 3).forEach((clip) => this.mediaSource.preloadClip(clip));
    } catch {
    } finally {
      this.loading.set(false);
    }
  }

  async addFakeParticipant(clip: ClipInfo): Promise<void> {
    const name = this.newFakeName().trim() || clip.name;
    this.addingFakeClipId.set(clip.id);
    this.errorMessage.set(null);
    try {
      await this.fakeParticipants.add(this.roomCode(), clip, name);
      this.newFakeName.set('');
    } catch {
      this.errorMessage.set(`Could not add "${name}" as a fake participant.`);
    } finally {
      this.addingFakeClipId.set(null);
    }
  }

  async removeFake(id: string): Promise<void> {
    await this.fakeParticipants.remove(id);
  }

  async toggleFakeMic(id: string, enabled: boolean): Promise<void> {
    await this.fakeParticipants.setMicEnabled(id, enabled);
  }

  async toggleFakeCamera(id: string, enabled: boolean): Promise<void> {
    await this.fakeParticipants.setCameraEnabled(id, enabled);
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
      this.errorMessage.set('Failed to upload the clip. Please try again.');
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
