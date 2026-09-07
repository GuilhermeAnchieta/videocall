import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { VideoTileComponent } from '../../components/video-tile/video-tile.component';
import { ControlsBarComponent } from '../../components/controls-bar/controls-bar.component';
import { ParticipantsPanelComponent } from '../../components/participants-panel/participants-panel.component';
import { ChatPanelComponent } from '../../components/chat-panel/chat-panel.component';
import { ClipsPanelComponent } from '../../components/clips-panel/clips-panel.component';
import { LivekitService } from '../../services/livekit.service';
import { MediaSourceService } from '../../services/media-source.service';
import { FakeParticipantsService } from '../../services/fake-participants.service';
import { RoomService } from '../../services/room.service';
import { getCurrentUserId } from '../../services/current-user';
import { ParticipantView } from '../../models/room-state';

@Component({
  selector: 'app-call-room',
  standalone: true,
  imports: [
    VideoTileComponent,
    ControlsBarComponent,
    ParticipantsPanelComponent,
    ChatPanelComponent,
    ClipsPanelComponent
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
  private readonly fakeParticipants = inject(FakeParticipantsService);

  readonly connectionState = this.livekit.connectionState;
  readonly chatMessages = this.livekit.chatMessages;
  readonly roomCode = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly isOwner = signal(false);

  readonly participantsPanelOpen = signal(false);
  readonly chatPanelOpen = signal(false);
  readonly clipsPanelOpen = signal(false);

  readonly displayParticipants = computed<ParticipantView[]>(() => {
    const usingClip = this.mediaSource.mode() === 'clip';
    const fakeViews = this.fakeParticipants.participantViews();
    // No lado do dono, a conexão principal também enxerga cada bot como um participante
    // remoto comum (é uma conexão LiveKit de verdade); descarta essa versão "crua" pra
    // não duplicar o tile e usar a versão com isFake/fakeId (controles no hover).
    const fakeIdentities = new Set(fakeViews.map((f) => f.identity));
    const real = this.livekit
      .participants()
      .filter((p) => !fakeIdentities.has(p.identity))
      .map((p) => (p.isLocal ? { ...p, usingClip } : p));
    return [...real, ...fakeViews];
  });

  readonly localParticipant = computed(() => this.displayParticipants().find((p) => p.isLocal));
  readonly micEnabled = computed(() => this.localParticipant()?.micEnabled ?? false);
  readonly cameraEnabled = computed(() => this.localParticipant()?.cameraEnabled ?? false);
  readonly usingClip = computed(() => this.localParticipant()?.usingClip ?? false);

  readonly participantsCount = computed(() => this.displayParticipants().length);

  private readonly lastSeenChatCount = signal(0);
  readonly hasUnreadChat = computed(
    () => !this.chatPanelOpen() && this.chatMessages().length > this.lastSeenChatCount()
  );

  readonly codeCopied = signal(false);
  private copyResetTimer?: ReturnType<typeof setTimeout>;

  private readonly controlsIdle = signal(false);
  private hideControlsTimer?: ReturnType<typeof setTimeout>;
  private static readonly CONTROLS_HIDE_DELAY = 4000;

  readonly controlsVisible = computed(
    () =>
      this.connectionState() !== 'connected' ||
      this.participantsPanelOpen() ||
      this.chatPanelOpen() ||
      this.clipsPanelOpen() ||
      !this.controlsIdle()
  );

  @HostListener('pointerdown')
  @HostListener('pointermove')
  wakeControls(): void {
    this.controlsIdle.set(false);
    this.scheduleControlsHide();
  }

  private scheduleControlsHide(): void {
    clearTimeout(this.hideControlsTimer);
    this.hideControlsTimer = setTimeout(
      () => this.controlsIdle.set(true),
      CallRoomComponent.CONTROLS_HIDE_DELAY
    );
  }

  async ngOnInit(): Promise<void> {
    const code = this.route.snapshot.paramMap.get('roomCode');
    const name = this.route.snapshot.queryParamMap.get('name');
    if (!code || !name) {
      await this.router.navigate(['/']);
      return;
    }

    this.roomCode.set(code);
    // Quem é o dono é só um "bônus" de UI (mostrar/esconder o botão de clipes) — não pode
    // travar a entrada na chamada se o Firebase (Auth/Firestore) estiver lento ou fora do
    // ar. Roda em paralelo, sem bloquear o connect ao LiveKit (que é o que importa de verdade).
    void this.resolveOwnership(code);

    try {
      const { token, livekitUrl } = await this.roomService.getAccessToken(code, name);
      await this.livekit.connect(livekitUrl, token);
      this.scheduleControlsHide();
    } catch {
      this.errorMessage.set(
        'Não foi possível entrar na sala. Verifique sua conexão, as Netlify Functions e o servidor LiveKit.'
      );
    }
  }

  private async resolveOwnership(code: string): Promise<void> {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000));
    try {
      const [ownerUid, myUid] = (await Promise.race([
        Promise.all([this.roomService.getRoomOwnerUid(code), getCurrentUserId()]),
        timeout
      ])) as [string | undefined, string];
      this.isOwner.set(!!ownerUid && ownerUid === myUid);
    } catch {
      this.isOwner.set(false);
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideControlsTimer);
    clearTimeout(this.copyResetTimer);
    this.mediaSource.dispose();
    this.fakeParticipants.dispose();
    void this.livekit.disconnect();
  }

  async copyRoomCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.roomCode());
      this.codeCopied.set(true);
      clearTimeout(this.copyResetTimer);
      this.copyResetTimer = setTimeout(() => this.codeCopied.set(false), 2000);
    } catch {
      // clipboard access denied; ignore silently
    }
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

  toggleClipsPanel(): void {
    if (!this.isOwner()) return;
    this.clipsPanelOpen.update((open) => !open);
    if (this.clipsPanelOpen()) {
      this.participantsPanelOpen.set(false);
      this.chatPanelOpen.set(false);
    }
    this.wakeControls();
  }

  closeClipsPanel(): void {
    this.clipsPanelOpen.set(false);
    this.wakeControls();
  }

  toggleParticipantsPanel(): void {
    this.participantsPanelOpen.update((open) => !open);
    if (this.participantsPanelOpen()) {
      this.chatPanelOpen.set(false);
      this.clipsPanelOpen.set(false);
    }
    this.wakeControls();
  }

  toggleChatPanel(): void {
    this.chatPanelOpen.update((open) => !open);
    if (this.chatPanelOpen()) {
      this.participantsPanelOpen.set(false);
      this.clipsPanelOpen.set(false);
      this.lastSeenChatCount.set(this.chatMessages().length);
    }
    this.wakeControls();
  }

  async toggleFakeMic(fakeId: string, enabled: boolean): Promise<void> {
    await this.fakeParticipants.setMicEnabled(fakeId, enabled);
  }

  async toggleFakeCamera(fakeId: string, enabled: boolean): Promise<void> {
    await this.fakeParticipants.setCameraEnabled(fakeId, enabled);
  }

  async removeFake(fakeId: string): Promise<void> {
    await this.fakeParticipants.remove(fakeId);
  }
}
