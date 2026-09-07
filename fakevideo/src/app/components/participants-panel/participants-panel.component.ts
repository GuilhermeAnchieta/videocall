import { Component, input, output } from '@angular/core';
import { ParticipantView } from '../../models/room-state';

@Component({
  selector: 'app-participants-panel',
  standalone: true,
  templateUrl: './participants-panel.component.html',
  styleUrl: './participants-panel.component.scss'
})
export class ParticipantsPanelComponent {
  readonly participants = input.required<ParticipantView[]>();
  readonly close = output<void>();
}
