import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-controls-bar',
  standalone: true,
  templateUrl: './controls-bar.component.html',
  styleUrl: './controls-bar.component.scss'
})
export class ControlsBarComponent {
  readonly micEnabled = input.required<boolean>();
  readonly cameraEnabled = input.required<boolean>();
  readonly usingClip = input<boolean>(false);
  readonly participantsOpen = input<boolean>(false);
  readonly chatOpen = input<boolean>(false);

  readonly toggleMic = output<void>();
  readonly toggleCamera = output<void>();
  readonly leaveCall = output<void>();
  readonly openMediaSwitch = output<void>();
  readonly toggleParticipants = output<void>();
  readonly toggleChat = output<void>();
}
