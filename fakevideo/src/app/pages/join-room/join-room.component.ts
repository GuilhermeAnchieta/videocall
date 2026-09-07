import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-join-room',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './join-room.component.html',
  styleUrl: './join-room.component.scss'
})
export class JoinRoomComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly roomService = inject(RoomService);

  private readonly previewVideo = viewChild<ElementRef<HTMLVideoElement>>('previewVideo');
  private previewStream: MediaStream | null = null;

  readonly displayName = signal('');
  readonly roomCode = signal('');
  readonly previewCameraEnabled = signal(true);
  readonly previewMicEnabled = signal(true);
  readonly previewError = signal<string | null>(null);
  readonly creatingRoom = signal(false);
  readonly joining = signal(false);

  ngOnInit(): void {
    const codeFromUrl = this.route.snapshot.queryParamMap.get('room');
    if (codeFromUrl) {
      this.roomCode.set(codeFromUrl);
    }
    void this.startPreview();
  }

  ngOnDestroy(): void {
    this.stopPreview();
  }

  toggleCamera(): void {
    const enabled = !this.previewCameraEnabled();
    this.previewCameraEnabled.set(enabled);
    this.previewStream?.getVideoTracks().forEach((track) => (track.enabled = enabled));
  }

  toggleMic(): void {
    const enabled = !this.previewMicEnabled();
    this.previewMicEnabled.set(enabled);
    this.previewStream?.getAudioTracks().forEach((track) => (track.enabled = enabled));
  }

  async createRoom(): Promise<void> {
    this.creatingRoom.set(true);
    this.previewError.set(null);
    try {
      const code = await this.roomService.createRoom();
      this.roomCode.set(code);
    } catch {
      this.previewError.set('Não foi possível criar a sala. Verifique se o netlify dev (ou o site publicado) e os emuladores estão rodando.');
    } finally {
      this.creatingRoom.set(false);
    }
  }

  async join(): Promise<void> {
    const name = this.displayName().trim();
    const code = this.roomCode().trim();
    if (!name || !code || this.joining()) return;

    this.joining.set(true);
    this.stopPreview();
    await this.router.navigate(['/call', code], { queryParams: { name } });
  }

  private async startPreview(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.previewStream = stream;
      const el = this.previewVideo()?.nativeElement;
      if (el) {
        el.srcObject = stream;
      }
    } catch {
      this.previewError.set('Não foi possível acessar câmera/microfone. Você ainda pode entrar na sala.');
    }
  }

  private stopPreview(): void {
    this.previewStream?.getTracks().forEach((track) => track.stop());
    this.previewStream = null;
  }
}
