import {
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LivekitService } from '../../services/livekit.service';
import { AudioOutputService } from '../../services/audio-output.service';

@Component({
  selector: 'app-controls-bar',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './controls-bar.component.html',
  styleUrl: './controls-bar.component.scss'
})
export class ControlsBarComponent implements OnDestroy {
  private readonly livekit = inject(LivekitService);
  private readonly audioOutput = inject(AudioOutputService);

  readonly micEnabled = input.required<boolean>();
  readonly cameraEnabled = input.required<boolean>();
  readonly handRaised = input<boolean>(false);
  readonly participantsOpen = input<boolean>(false);
  readonly chatOpen = input<boolean>(false);
  readonly visible = input<boolean>(true);
  readonly participantsCount = input<number>(0);
  readonly hasUnreadChat = input<boolean>(false);
  readonly isOwner = input<boolean>(false);

  @HostBinding('class.hidden')
  get isHidden(): boolean {
    return !this.visible();
  }

  readonly toggleMic = output<void>();
  readonly toggleCamera = output<void>();
  readonly leaveCall = output<void>();
  readonly toggleClipsPanel = output<void>();
  readonly toggleParticipants = output<void>();
  readonly toggleChat = output<void>();
  readonly triggerTeleport = output<void>();
  readonly sendReaction = output<string>();
  readonly toggleHand = output<void>();

  readonly REACTIONS = ['❤️', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔', '👎'];
  readonly reactionMenuOpen = signal(false);
  private readonly reactionWrap = viewChild<ElementRef<HTMLElement>>('reactionWrap');

  toggleReactionMenu(): void {
    this.reactionMenuOpen.update((open) => !open);
  }

  pickReaction(emoji: string): void {
    this.sendReaction.emit(emoji);
    this.reactionMenuOpen.set(false);
  }

  readonly confirmingLeave = signal(false);
  private confirmTimer?: ReturnType<typeof setTimeout>;

  requestLeave(): void {
    if (this.confirmingLeave()) return;
    this.confirmingLeave.set(true);
    this.confirmTimer = setTimeout(() => this.confirmingLeave.set(false), 4000);
  }

  cancelLeave(): void {
    clearTimeout(this.confirmTimer);
    this.confirmingLeave.set(false);
  }

  confirmLeave(): void {
    clearTimeout(this.confirmTimer);
    this.confirmingLeave.set(false);
    this.leaveCall.emit();
  }

  readonly confirmingTeleport = signal(false);
  private teleportConfirmTimer?: ReturnType<typeof setTimeout>;

  requestTeleport(): void {
    if (this.confirmingTeleport()) return;
    this.confirmingTeleport.set(true);
    this.teleportConfirmTimer = setTimeout(() => this.confirmingTeleport.set(false), 4000);
  }

  cancelTeleport(): void {
    clearTimeout(this.teleportConfirmTimer);
    this.confirmingTeleport.set(false);
  }

  confirmTeleport(): void {
    clearTimeout(this.teleportConfirmTimer);
    this.confirmingTeleport.set(false);
    this.triggerTeleport.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancelLeave();
    this.cancelTeleport();
    this.micMenuOpen.set(false);
    this.cameraMenuOpen.set(false);
    this.reactionMenuOpen.set(false);
  }

  private readonly leaveWrap = viewChild<ElementRef<HTMLElement>>('leaveWrap');
  private readonly teleportWrap = viewChild<ElementRef<HTMLElement>>('teleportWrap');
  private readonly micWrap = viewChild<ElementRef<HTMLElement>>('micWrap');
  private readonly cameraWrap = viewChild<ElementRef<HTMLElement>>('cameraWrap');

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node;
    // Each popover closes when clicking ANYWHERE outside its own button+arrow
    // pair — including on another button in the bar, not just outside the whole component.
    if (this.confirmingLeave() && !this.leaveWrap()?.nativeElement.contains(target)) {
      this.cancelLeave();
    }
    if (this.confirmingTeleport() && !this.teleportWrap()?.nativeElement.contains(target)) {
      this.cancelTeleport();
    }
    if (this.micMenuOpen() && !this.micWrap()?.nativeElement.contains(target)) {
      this.micMenuOpen.set(false);
    }
    if (this.reactionMenuOpen() && !this.reactionWrap()?.nativeElement.contains(target)) {
      this.reactionMenuOpen.set(false);
    }
    if (this.cameraMenuOpen() && !this.cameraWrap()?.nativeElement.contains(target)) {
      this.cameraMenuOpen.set(false);
    }
  }

  readonly micMenuOpen = signal(false);
  readonly cameraMenuOpen = signal(false);
  readonly sinkIdSupported = this.audioOutput.sinkIdSupported;
  readonly microphones = signal<MediaDeviceInfo[]>([]);
  readonly speakers = signal<MediaDeviceInfo[]>([]);
  readonly cameras = signal<MediaDeviceInfo[]>([]);
  readonly selectedMicId = signal<string | undefined>(undefined);
  readonly selectedSpeakerId = signal<string | undefined>(undefined);
  readonly selectedCameraId = signal<string | undefined>(undefined);

  // Live mic input level (0-1 per bar), driving the 3-bar meter that replaces the chevron
  // icon while the mic is on — same idea as Meet's mic button.
  readonly micLevels = signal<[number, number, number]>([0.15, 0.15, 0.15]);
  private levelAudioContext?: AudioContext;
  private levelAnalyser?: AnalyserNode;
  private levelRafId?: number;

  constructor() {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());

    effect(() => {
      if (this.micEnabled()) {
        this.startMicLevelMonitoring();
      } else {
        this.stopMicLevelMonitoring();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopMicLevelMonitoring();
  }

  private startMicLevelMonitoring(): void {
    this.stopMicLevelMonitoring();
    const mediaTrack = this.livekit.getLocalAudioTrack()?.mediaStreamTrack;
    if (!mediaTrack) return;

    this.levelAudioContext = new AudioContext();
    const source = this.levelAudioContext.createMediaStreamSource(new MediaStream([mediaTrack]));
    const analyser = this.levelAudioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    this.levelAnalyser = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    // getLocalAudioTrack() is always THIS device's own mic — it can never be a remote
    // participant's audio. But without headphones, this device's own speakers play that remote
    // voice out loud, and this same mic physically picks that up again, which looks identical
    // to an analyser. A single loudness threshold still lets that leak through, so this uses a
    // Schmitt-trigger gate instead: the meter only turns on once the level clearly exceeds
    // OPEN_THRESHOLD, and turns back off only once it drops below a lower CLOSE_THRESHOLD. That
    // gap (instead of one shared cutoff) stops it from flickering on quieter, more distant
    // sound like speaker leakage while still responding readily to someone speaking directly
    // into the mic. It cannot fully replace using headphones when testing without them, since
    // the leaked audio and real speech share the same physical microphone.
    const OPEN_THRESHOLD = 62;
    const CLOSE_THRESHOLD = 38;
    let gateOpen = false;

    const loop = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;

      if (gateOpen) {
        if (avg < CLOSE_THRESHOLD) gateOpen = false;
      } else if (avg > OPEN_THRESHOLD) {
        gateOpen = true;
      }

      if (!gateOpen) {
        this.micLevels.set([0.15, 0.15, 0.15]);
      } else {
        const level = 0.15 + Math.min(1, (avg - CLOSE_THRESHOLD) / (170 - CLOSE_THRESHOLD)) * 0.85;
        // Same level driving all 3 bars, with a per-bar multiplier for visual variety instead
        // of arbitrary frequency bins (which were more prone to reacting to a narrow-band hum).
        this.micLevels.set([level, level * 0.85 + 0.05, level * 0.7 + 0.08]);
      }

      this.levelRafId = requestAnimationFrame(loop);
    };
    loop();
  }

  private stopMicLevelMonitoring(): void {
    if (this.levelRafId !== undefined) cancelAnimationFrame(this.levelRafId);
    this.levelRafId = undefined;
    this.levelAnalyser = undefined;
    void this.levelAudioContext?.close();
    this.levelAudioContext = undefined;
    this.micLevels.set([0.15, 0.15, 0.15]);
  }

  async toggleMicMenu(): Promise<void> {
    const opening = !this.micMenuOpen();
    this.micMenuOpen.set(opening);
    this.cameraMenuOpen.set(false);
    if (opening) await this.refreshDevices();
  }

  async toggleCameraMenu(): Promise<void> {
    const opening = !this.cameraMenuOpen();
    this.cameraMenuOpen.set(opening);
    this.micMenuOpen.set(false);
    if (opening) await this.refreshDevices();
  }

  private async refreshDevices(): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.microphones.set(devices.filter((d) => d.kind === 'audioinput'));
    this.speakers.set(devices.filter((d) => d.kind === 'audiooutput'));
    this.cameras.set(devices.filter((d) => d.kind === 'videoinput'));
    this.selectedMicId.set(this.livekit.getActiveMicrophoneId());
    this.selectedSpeakerId.set(this.audioOutput.outputDevice());
    this.selectedCameraId.set(this.livekit.getActiveCameraId());
  }

  async onMicSelected(deviceId: string): Promise<void> {
    this.selectedMicId.set(deviceId);
    await this.livekit.switchMicrophone(deviceId);
    // Switching devices swaps out the underlying MediaStreamTrack, so the analyser needs to be
    // rebuilt against the new one instead of silently keeping the old (now-stopped) track.
    if (this.micEnabled()) this.startMicLevelMonitoring();
  }

  async onSpeakerSelected(deviceId: string): Promise<void> {
    this.selectedSpeakerId.set(deviceId);
    await this.audioOutput.setOutputDevice(deviceId);
  }

  async onCameraSelected(deviceId: string): Promise<void> {
    this.selectedCameraId.set(deviceId);
    await this.livekit.switchCamera(deviceId);
  }
}
