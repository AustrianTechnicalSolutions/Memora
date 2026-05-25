import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../translation/translate.pipe';

@Component({
  selector: 'app-challenge-notification',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './challenge-notification.html',
  styleUrls: ['./challenge-notification.css']
})
export class ChallengeNotificationComponent {
  @Input() challengerName = '';
  @Output() accepted = new EventEmitter<void>();
  @Output() declined = new EventEmitter<void>();
}
