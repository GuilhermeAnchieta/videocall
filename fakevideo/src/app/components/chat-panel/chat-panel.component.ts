import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatMessage } from '../../models/room-state';

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss'
})
export class ChatPanelComponent {
  readonly messages = input.required<ChatMessage[]>();
  readonly close = output<void>();
  readonly send = output<string>();

  readonly draft = signal('');
  private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  constructor() {
    effect(() => {
      this.messages();
      const el = this.scrollContainer()?.nativeElement;
      if (el) {
        queueMicrotask(() => (el.scrollTop = el.scrollHeight));
      }
    });
  }

  submit(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.send.emit(text);
    this.draft.set('');
  }
}
