import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RoomService } from '../../services/room.service';
import { APP_VERSION } from '../../version';

export type JoinMode = 'choose' | 'join' | 'host';

@Component({
  selector: 'app-join-room',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './join-room.component.html',
  styleUrl: './join-room.component.scss'
})
export class JoinRoomComponent implements OnInit, OnDestroy {
  readonly appVersion = APP_VERSION;

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

  /**
   * Whoever creates the room becomes the owner (ownerUid stored in Firestore) and gets
   * the clips/fake participants button; whoever joins with a code is always a regular
   * participant. Separating the two actions into distinct screens avoids someone accidentally
   * creating a new room (and becoming "owner" by accident) while trying to just join with a code.
   */
  readonly mode = signal<JoinMode>('choose');

  ngOnInit(): void {
    const codeFromUrl = this.route.snapshot.queryParamMap.get('room');
    if (codeFromUrl) {
      this.roomCode.set(codeFromUrl);
      this.mode.set('join');
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

  chooseJoin(): void {
    this.previewError.set(null);
    this.mode.set('join');
  }

  backToChoice(): void {
    this.previewError.set(null);
    this.roomCode.set('');
    this.mode.set('choose');
  }

  async hostRoom(): Promise<void> {
    const name = this.displayName().trim();
    if (!name || this.creatingRoom() || this.joining()) return;

    this.creatingRoom.set(true);
    this.previewError.set(null);
    this.mode.set('host');
    try {
      const code = await this.roomService.createRoom();
      this.roomCode.set(code);
      await this.enterCall(code, name, true);
    } catch {
      this.previewError.set(
        'Could not create the room. Make sure netlify dev (or the published site) and the emulators are running.'
      );
      this.creatingRoom.set(false);
      this.mode.set('choose');
    }
  }

  async join(): Promise<void> {
    const name = this.displayName().trim();
    const code = this.roomCode().trim();
    if (!name || !code || this.joining()) return;

    await this.enterCall(code, name);
  }

  private async enterCall(code: string, name: string, isHost = false): Promise<void> {
    this.joining.set(true);
    this.stopPreview();
    await this.router.navigate(['/call', code], {
      queryParams: { name, host: isHost ? '1' : null }
    });
  }

  private async startPreview(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      this.previewStream = stream;
      const el = this.previewVideo()?.nativeElement;
      if (el) {
        el.muted = true;
        el.srcObject = stream;
      }
    } catch {
      this.previewError.set('Could not access camera/microphone. You can still join the room.');
    }
  }

  private stopPreview(): void {
    this.previewStream?.getTracks().forEach((track) => track.stop());
    this.previewStream = null;
  }
}
