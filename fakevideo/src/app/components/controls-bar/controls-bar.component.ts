import {
  Component,
  ElementRef,
  HostBinding,
  HostListener,
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
export class ControlsBarComponent {
  private readonly livekit = inject(LivekitService);
  private readonly audioOutput = inject(AudioOutputService);

  readonly micEnabled = input.required<boolean>();
  readonly cameraEnabled = input.required<boolean>();
  readonly usingClip = input<boolean>(false);
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancelLeave();
    this.micMenuOpen.set(false);
    this.cameraMenuOpen.set(false);
  }

  private readonly leaveWrap = viewChild<ElementRef<HTMLElement>>('leaveWrap');
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
    if (this.micMenuOpen() && !this.micWrap()?.nativeElement.contains(target)) {
      this.micMenuOpen.set(false);
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

  constructor() {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
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
