import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { VideoTileComponent } from '../../components/video-tile/video-tile.component';
import { ControlsBarComponent } from '../../components/controls-bar/controls-bar.component';
import { ParticipantsPanelComponent } from '../../components/participants-panel/participants-panel.component';
import { ChatPanelComponent } from '../../components/chat-panel/chat-panel.component';
import { MediaSwitchModalComponent } from '../../components/media-switch-modal/media-switch-modal.component';
import { LivekitService } from '../../services/livekit.service';
import { MediaSourceService } from '../../services/media-source.service';
import { RoomService } from '../../services/room.service';
import { ParticipantView } from '../../models/room-state';

@Component({
  selector: 'app-call-room',
  standalone: true,
  imports: [
    VideoTileComponent,
    ControlsBarComponent,
    ParticipantsPanelComponent,
    ChatPanelComponent,
    MediaSwitchModalComponent
  ],
  templateUrl: './call-room.component.html',
  styleUrl: './call-room.component.scss'
})
export class CallRoomComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly roomService = inject(RoomService);
  private readonly livekit = inject(LivekitService);
  private readonly mediaSource = inject(MediaSourceService);

  readonly connectionState = this.livekit.connectionState;
  readonly chatMessages = this.livekit.chatMessages;
  readonly roomCode = signal('');
  readonly errorMessage = signal<string | null>(null);

  readonly participantsPanelOpen = signal(false);
  readonly chatPanelOpen = signal(false);
  readonly mediaSwitchOpen = signal(false);

  readonly displayParticipants = computed<ParticipantView[]>(() => {
    const usingClip = this.mediaSource.mode() === 'clip';
    return this.livekit.participants().map((p) => (p.isLocal ? { ...p, usingClip } : p));
  });

  readonly localParticipant = computed(() => this.displayParticipants().find((p) => p.isLocal));
  readonly micEnabled = computed(() => this.localParticipant()?.micEnabled ?? false);
  readonly cameraEnabled = computed(() => this.localParticipant()?.cameraEnabled ?? false);
  readonly usingClip = computed(() => this.localParticipant()?.usingClip ?? false);

  readonly gridClass = computed(() => {
    const count = this.displayParticipants().length;
    if (count <= 1) return 'grid-1';
    if (count === 2) return 'grid-2';
    if (count <= 4) return 'grid-4';
    return 'grid-many';
  });

  async ngOnInit(): Promise<void> {
    const code = this.route.snapshot.paramMap.get('roomCode');
    const name = this.route.snapshot.queryParamMap.get('name');
    if (!code || !name) {
      await this.router.navigate(['/']);
      return;
    }

    this.roomCode.set(code);
    try {
      const { token, livekitUrl } = await this.roomService.getAccessToken(code, name);
      await this.livekit.connect(livekitUrl, token);
    } catch {
      this.errorMessage.set(
        'Não foi possível entrar na sala. Verifique sua conexão, as Netlify Functions e o servidor LiveKit.'
      );
    }
  }

  ngOnDestroy(): void {
    this.mediaSource.dispose();
    void this.livekit.disconnect();
  }

  async toggleMic(): Promise<void> {
    await this.livekit.setMicEnabled(!this.micEnabled());
  }

  async toggleCamera(): Promise<void> {
    await this.livekit.setCameraEnabled(!this.cameraEnabled());
  }

  async leaveCall(): Promise<void> {
    await this.router.navigate(['/']);
  }

  sendChat(text: string): void {
    this.livekit.sendChatMessage(text);
  }

  openMediaSwitch(): void {
    this.mediaSwitchOpen.set(true);
  }

  toggleParticipantsPanel(): void {
    this.participantsPanelOpen.update((open) => !open);
    if (this.participantsPanelOpen()) this.chatPanelOpen.set(false);
  }

  toggleChatPanel(): void {
    this.chatPanelOpen.update((open) => !open);
    if (this.chatPanelOpen()) this.participantsPanelOpen.set(false);
  }
}
