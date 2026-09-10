import { Component, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
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
import { AudioOutputService } from '../../services/audio-output.service';
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
  private readonly audioOutput = inject(AudioOutputService);

  readonly connectionState = this.livekit.connectionState;
  readonly audioPlaybackBlocked = this.audioOutput.playbackBlocked;
  readonly chatMessages = this.livekit.chatMessages;
  readonly roomCode = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly isOwner = signal(false);

  readonly participantsPanelOpen = signal(false);
  readonly chatPanelOpen = signal(false);
  readonly clipsPanelOpen = signal(false);

  readonly teleportActive = signal(false);
  readonly frozenFakeIds = signal<ReadonlySet<string>>(new Set());
  readonly teleportParticles = Array.from({ length: 24 }, (_, i) => i);
  private static readonly TELEPORT_EFFECT_DURATION = 1800;
  private static readonly TELEPORT_DROP_DELAY = 900;
  private teleportEffectTimer?: ReturnType<typeof setTimeout>;
  private teleportDropTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Baseline captured at construction time, not a hardcoded 0: teleportPulse is a
    // service-wide signal that can already be non-zero from a previous room in this
    // session, and we only want to react to a pulse that happens from here on (a real
    // click on the teleport button), not replay a stale one on mount.
    const teleportBaseline = this.livekit.teleportPulse();
    effect((onCleanup) => {
      const pulse = this.livekit.teleportPulse();
      if (pulse <= teleportBaseline) return;
      // untracked() is essential here: playTeleportEffect() reads isOwner() and
      // fakeParticipants.participantViews() (for the id snapshot). Without untracked(),
      // Angular's effect() registers every signal read synchronously inside it as a
      // dependency — so this effect would start re-running whenever the fake participant
      // list changes (e.g. a clip added after the teleport), replaying the same stale
      // pulse and sweeping away participants that had nothing to do with the original click.
      untracked(() => this.playTeleportEffect());
      onCleanup(() => {
        clearTimeout(this.teleportEffectTimer);
        clearTimeout(this.teleportDropTimer);
      });
    });
  }

  readonly displayParticipants = computed<ParticipantView[]>(() => {
    const fakeViews = this.fakeParticipants.participantViews();
    // On the owner's side, the main connection also sees each bot as a regular remote
    // participant (it's a real LiveKit connection); discard that "raw" version to avoid
    // duplicating the tile and use the version with isFake/fakeId instead (hover controls).
    const fakeIdentities = new Set(fakeViews.map((f) => f.identity));
    const real = this.livekit.participants().filter((p) => !fakeIdentities.has(p.identity));
    return [...real, ...fakeViews];
  });

  readonly localParticipant = computed(() => this.displayParticipants().find((p) => p.isLocal));
  readonly micEnabled = computed(() => this.localParticipant()?.micEnabled ?? false);
  readonly cameraEnabled = computed(() => this.localParticipant()?.cameraEnabled ?? false);

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
    // Whoever created the room navigates here with "?host=1" (see join-room.component.ts);
    // whoever joins with a code doesn't have that param and never becomes owner.
    this.isOwner.set(this.route.snapshot.queryParamMap.get('host') === '1');

    const micEnabled = this.route.snapshot.queryParamMap.get('mic') !== '0';
    const cameraEnabled = this.route.snapshot.queryParamMap.get('camera') !== '0';

    try {
      const { token, livekitUrl } = await this.roomService.getAccessToken(code, name);
      await this.livekit.connect(livekitUrl, token, { micEnabled, cameraEnabled });
      this.scheduleControlsHide();
    } catch {
      this.errorMessage.set(
        'Could not join the room. Check your connection, the Netlify Functions, and the LiveKit server.'
      );
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideControlsTimer);
    clearTimeout(this.copyResetTimer);
    clearTimeout(this.teleportEffectTimer);
    clearTimeout(this.teleportDropTimer);
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

  enableAudio(): void {
    this.audioOutput.retryPlayback();
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

  triggerTeleport(): void {
    if (!this.isOwner()) return;
    this.livekit.triggerTeleportEffect();
  }

  /**
   * Runs for everyone in the room (triggered locally by the host, or received over the
   * data channel by everyone else) so the visual effect plays in sync. Only the host's
   * browser actually owns the fake participants' connections, so only it follows through
   * with freezing and dropping them.
   */
  private playTeleportEffect(): void {
    this.teleportActive.set(true);
    clearTimeout(this.teleportEffectTimer);
    this.teleportEffectTimer = setTimeout(
      () => this.teleportActive.set(false),
      CallRoomComponent.TELEPORT_EFFECT_DURATION
    );

    if (!this.isOwner()) return;

    // Snapshot who's here right now: a clip added during the drop delay below must not be
    // swept away by a removal that was scheduled before it even existed.
    const idsAtTrigger = new Set(this.fakeParticipants.participantViews().map((p) => p.fakeId!));
    this.fakeParticipants.freezeMany(idsAtTrigger);
    this.frozenFakeIds.set(idsAtTrigger);

    clearTimeout(this.teleportDropTimer);
    this.teleportDropTimer = setTimeout(async () => {
      await this.fakeParticipants.removeMany(idsAtTrigger);
      this.frozenFakeIds.set(new Set());
    }, CallRoomComponent.TELEPORT_EFFECT_DURATION + CallRoomComponent.TELEPORT_DROP_DELAY);
  }
}
