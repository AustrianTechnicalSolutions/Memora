import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MemoryDto, AlbumDto, GroupsService, DuelStateDto } from '../groups';
import { environment } from '../../../environment';
import { TranslatePipe } from '../../translation/translate.pipe';

const QUESTION_SECONDS = 15;
const TIMEOUT_TOKEN = '__timeout__';

interface GameQuestion {
  memory: MemoryDto;
  correctAnswer: string;
  options: string[];
  albumAnswer: string | null;
  albumOptions: string[];
}

@Component({
  selector: 'app-guess-game',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './guess-game.html',
  styleUrls: ['./guess-game.css']
})
export class GuessGameComponent implements OnInit, OnDestroy {
  @Input() memories: MemoryDto[] = [];
  @Input() members: { userId: string; name: string; role: string }[] = [];
  @Input() albums: AlbumDto[] = [];
  @Input() groupId = '';

  @Input() duelId: string | null = null;
  @Input() duelMemoryIds: string[] | null = null;

  @Output() closed = new EventEmitter<void>();

  questions: GameQuestion[] = [];
  questionIndex = 0;
  selected: string | null = null;
  selectedAlbum: string | null = null;
  phase: 'question' | 'album' | 'result' = 'question';
  correct = 0;
  wrong = 0;
  albumMode = false;

  mediaUrl: string | null = null;
  mediaType: 'photo' | 'video' | 'quote' = 'quote';

  // Duel state
  duelState: DuelStateDto | null = null;
  timeLeft = QUESTION_SECONDS;
  waitingForFinalState = false;

  private pollTimer?: ReturnType<typeof setInterval>;
  private questionTimer?: ReturnType<typeof setInterval>;

  get isDuelMode(): boolean { return !!this.duelId; }
  get timedOut(): boolean { return this.selected === TIMEOUT_TOKEN; }

  get current(): GameQuestion | null {
    return this.questions[this.questionIndex] ?? null;
  }

  get total(): number { return this.questions.length; }

  get timerPercent(): number { return (this.timeLeft / QUESTION_SECONDS) * 100; }

  constructor(private http: HttpClient, private groupsService: GroupsService) {}

  ngOnInit() {
    this.generateQuestions();
    this.loadMedia();

    if (this.isDuelMode) {
      this.pollTimer = setInterval(() => this.pollDuelState(), 3000);
      this.startQuestionTimer();
    }
  }

  ngOnDestroy() {
    clearInterval(this.pollTimer);
    clearInterval(this.questionTimer);
  }

  private pollDuelState() {
    if (!this.duelId || !this.groupId) return;
    this.groupsService.duelState(this.groupId, this.duelId).subscribe({
      next: (s) => {
        this.duelState = s;
        if (s.status === 'finished') {
          this.waitingForFinalState = false;
          if (this.phase !== 'result') this.phase = 'result';
        }
      },
      error: () => {}
    });
  }

  private startQuestionTimer() {
    clearInterval(this.questionTimer);
    this.timeLeft = QUESTION_SECONDS;
    this.questionTimer = setInterval(() => {
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        clearInterval(this.questionTimer);
        if (this.selected === null && this.phase === 'question') {
          this.onTimeout();
        }
      }
    }, 1000);
  }

  private onTimeout() {
    if (this.selected !== null) return; // guard against double-fire
    this.selected = TIMEOUT_TOKEN;
    this.wrong++;
    if (this.duelId && this.groupId) {
      this.groupsService.duelAnswer(this.groupId, this.duelId, false).subscribe({
        next: (s) => { this.duelState = s; },
        error: () => {}
      });
    }
    setTimeout(() => {
      if (this.selected === TIMEOUT_TOKEN) this.advance(); // only advance if not manually moved
    }, 1800);
  }

  private generateQuestions() {
    const namePool = this.buildNamePool();
    const albumNames = this.albums.map(a => a.title);

    let pool: MemoryDto[];
    if (this.duelMemoryIds?.length) {
      const idSet = new Set(this.duelMemoryIds);
      pool = this.memories.filter(m => idSet.has(m.id));
    } else {
      pool = [...this.memories].sort(() => Math.random() - 0.5).slice(0, 12);
    }

    for (const memory of pool) {
      const correctAnswer = this.getCorrectAnswer(memory);
      const options = this.buildOptions(correctAnswer, namePool);

      let albumAnswer: string | null = null;
      let albumOptions: string[] = [];
      if (memory.happenedAt && albumNames.length >= 2) {
        const album = this.albums.find(a => {
          const mem = new Date(memory.happenedAt);
          const start = new Date(a.dateStart);
          const end = a.dateEnd ? new Date(a.dateEnd) : null;
          return mem >= start && (!end || mem <= end);
        });
        albumAnswer = album?.title ?? null;
        if (albumAnswer) albumOptions = this.buildAlbumOptions(albumAnswer, albumNames);
      }

      this.questions.push({ memory, correctAnswer, options, albumAnswer, albumOptions });
    }
  }

  private resolvePersonName(nameOrId: string): string {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
      return this.members.find(m => m.userId === nameOrId)?.name ?? 'Unknown';
    }
    return nameOrId;
  }

  private getCorrectAnswer(memory: MemoryDto): string {
    if (memory.type === 2) return memory.quoteBy?.trim() || 'Unknown';
    const people = (memory.people ?? []).filter(p => p?.trim());
    if (people.length > 0) return this.resolvePersonName(people[0]);
    // Fall back to creator when no one is tagged (e.g. drawings)
    if (memory.createdByUserId) return this.resolvePersonName(memory.createdByUserId);
    return 'Unknown';
  }

  private buildNamePool(): string[] {
    const names = new Set<string>();
    for (const m of this.members) names.add(m.name);
    for (const mem of this.memories) {
      if (mem.quoteBy?.trim()) names.add(mem.quoteBy.trim());
      if (mem.createdByUserId) {
        const name = this.resolvePersonName(mem.createdByUserId);
        if (name !== mem.createdByUserId) names.add(name); // only add if it resolved to a real name
      }
      for (const p of (mem.people ?? [])) {
        if (p?.trim()) names.add(this.resolvePersonName(p.trim()));
      }
    }
    names.add('Unknown');
    return Array.from(names);
  }

  private buildOptions(correct: string, pool: string[]): string[] {
    const others = pool.filter(n => n !== correct).sort(() => Math.random() - 0.5).slice(0, 3);
    const opts = [correct, ...others].sort(() => Math.random() - 0.5);
    while (opts.length < 4) opts.push('Unknown');
    return opts;
  }

  private buildAlbumOptions(correct: string, pool: string[]): string[] {
    const others = pool.filter(n => n !== correct).sort(() => Math.random() - 0.5).slice(0, 3);
    return [correct, ...others].sort(() => Math.random() - 0.5);
  }

  private loadMedia() {
    const q = this.current;
    if (!q) return;
    this.mediaUrl = null;
    const mem = q.memory;
    if (mem.type === 2) { this.mediaType = 'quote'; return; }
    this.mediaType = mem.type === 1 ? 'video' : 'photo';
    if (!mem.mediaUrl) return;

    this.http.get(environment.apiUrl + mem.mediaUrl, { responseType: 'blob' }).subscribe({
      next: (blob) => { this.mediaUrl = URL.createObjectURL(blob); },
      error: () => { this.mediaUrl = null; }
    });
  }

  select(option: string) {
    if (this.selected !== null) return;
    clearInterval(this.questionTimer);
    this.selected = option;
    const isCorrect = option === this.current?.correctAnswer;
    if (isCorrect) this.correct++; else this.wrong++;

    if (this.isDuelMode && this.duelId && this.groupId) {
      this.groupsService.duelAnswer(this.groupId, this.duelId, isCorrect).subscribe({
        next: (s) => { this.duelState = s; },
        error: () => {}
      });
    }
  }

  next() {
    const q = this.current;
    if (!q) return;
    if (this.albumMode && q.albumAnswer && q.albumOptions.length >= 2 && this.phase === 'question') {
      this.phase = 'album';
      this.selectedAlbum = null;
      return;
    }
    this.advance();
  }

  selectAlbum(option: string) {
    if (this.selectedAlbum !== null) return;
    this.selectedAlbum = option;
  }

  nextAfterAlbum() { this.advance(); }

  private advance() {
    clearInterval(this.questionTimer);
    this.selected = null;
    this.selectedAlbum = null;
    this.phase = 'question';
    if (this.questionIndex + 1 >= this.total) {
      this.phase = 'result';
      if (this.isDuelMode) {
        this.waitingForFinalState = true;
        this.pollDuelState(); // immediate poll; regular 3s timer keeps running
      }
    } else {
      this.questionIndex++;
      this.loadMedia();
      if (this.isDuelMode) this.startQuestionTimer();
    }
  }

  close() {
    if (this.isDuelMode && this.phase !== 'result' && this.duelId && this.groupId) {
      this.groupsService.duelQuit(this.groupId, this.duelId).subscribe({ error: () => {} });
    }
    this.closed.emit();
  }

  restart() {
    if (this.isDuelMode) { this.closed.emit(); return; }
    this.questions = [];
    this.questionIndex = 0;
    this.selected = null;
    this.selectedAlbum = null;
    this.phase = 'question';
    this.correct = 0;
    this.wrong = 0;
    this.mediaUrl = null;
    this.generateQuestions();
    this.loadMedia();
  }

  duelResultLabel(): string {
    const s = this.duelState;
    if (!s) return '⏳';
    if (s.myScore > s.opponentScore) return '🏆';
    if (s.myScore < s.opponentScore) return '😔';
    return '🤝';
  }

  optionClass(option: string): string {
    if (this.selected === null) return '';
    if (option === this.current?.correctAnswer) return 'correct';
    if (option === this.selected && !this.timedOut) return 'wrong';
    return 'dim';
  }

  albumOptionClass(option: string): string {
    if (this.selectedAlbum === null) return '';
    if (option === this.current?.albumAnswer) return 'correct';
    if (option === this.selectedAlbum) return 'wrong';
    return 'dim';
  }

  questionLabel(): string {
    const q = this.current;
    if (!q) return '';
    return q.memory.type === 2 ? 'Wer hat das gesagt?' : 'Wer ist in diesem Memory getaggt?';
  }
}
