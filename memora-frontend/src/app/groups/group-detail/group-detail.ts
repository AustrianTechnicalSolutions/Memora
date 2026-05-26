import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GroupsService, GroupDetailDto, MemoryDto, AlbumDto, GroupStatsDto, GroupWeeklyActivityDto, GroupMemberActivityDto } from '../groups';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../translation/translate.pipe';
import { AppLanguage, I18nService } from '../../translation/i18n.service';
import { AuthService } from '../../user/auth.service';
import { GuessGameComponent } from '../guess-game/guess-game';
import { ChallengeNotificationComponent } from '../challenge-notification/challenge-notification';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, GuessGameComponent, ChallengeNotificationComponent],
  templateUrl: './group-detail.html',
  styleUrls: ['./group-detail.css']
})
export class GroupDetailComponent implements OnInit, OnDestroy {

  groupId!: string;
  group?: GroupDetailDto;

  items: MemoryDto[] = [];

  activeTab: 'timeline' | 'members' = 'timeline';

  members: { userId: string, name: string, role: string }[] = [];
  creatorUserId: string | null = null;
  creatorName = '';

  // filters
  fType: number | null = null;
  fFrom: string = '';
  fTo: string = '';
  fSearch: string = '';
  fSort: 'newest' | 'oldest' = 'newest';

  // create memory
  showCreate = false;
  cType = 2;
  cHappenedAt = new Date().toISOString().slice(0, 10);
  cTitle = '';
  cQuoteText = '';
  cQuoteBy = '';
  cMediaUrl = '';
  cTags = '';
  selectedFile: File | null = null;
  
  // Tagging
  showMentionPopup = false;
  mentionQuery = '';
  mentionResults: { userId: string; name: string; role: string }[] = [];
  mentionIndex = 0;

  // Albums
  albums: AlbumDto[] = [];
  selectedAlbumId: string | null = null;

  showCreagroupStatsteAlbum = false;
  aTitle = '';
  aDescription = '';
  aDateStart = new Date().toISOString().slice(0, 10);
  aDateEnd = '';

  // Group stats
  groupStats?: GroupStatsDto;
  weeklyActivity?: GroupWeeklyActivityDto;

  memberActivity: GroupMemberActivityDto[] = [];
  mostActiveUserId?: string;
  topPhotoUserId?: string;
  topVideoUserId?: string;
  topQuoteUserId?: string;

  currentUserId: string | null = null;
  isAdmin = false;
  showGame = false;

  // Duel
  onlineMembers: { userId: string; name: string }[] = [];
  pendingChallenge: { duelId: string; challengerName: string; memoryCount: number } | null = null;
  showDuelGame = false;
  activeDuelId: string | null = null;
  activeDuelMemoryIds: string[] | null = null;
  challengeSentTo: string | null = null;
  private sentDuelId: string | null = null;

  declinedByName: string | null = null;

  private refreshTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private challengePollTimer?: ReturnType<typeof setInterval>;
  private declinedMessageTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private groupsService: GroupsService,
    private i18n: I18nService,
    private auth: AuthService
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.groupId = params.get('id')!;

      this.groupsService.groupDetail(this.groupId).subscribe({
        next: (g) => {
          this.group = g;

          this.creatorUserId = (g as any).createdByUserName;

          this.reload();
          this.loadMembers();
          this.loadStats();
          this.loadActivity();
          this.loadMemberActivity();
        },
        error: () => {}
      });

      this.loadAlbums();
      this.startDuelTimers();
    });

    this.auth.currentUser().subscribe(u => {
      this.currentUserId = u.id;
      // Re-check admin in case loadMembers() already ran (race condition)
      this.isAdmin = this.members.some(m => m.userId === u.id && m.role === 'Admin');
    });

    this.refreshTimer = setInterval(() => this.reload(), 30_000);
  }

  ngOnDestroy() {
    clearInterval(this.refreshTimer);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.challengePollTimer);
    clearTimeout(this.declinedMessageTimer);
  }

  private startDuelTimers() {
    // Clear any existing timers (route can re-fire if navigating between groups)
    clearInterval(this.heartbeatTimer);
    clearInterval(this.challengePollTimer);

    this.sendHeartbeat();
    this.pollOnlineMembers();
    this.pollPendingChallenge();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
      this.pollOnlineMembers();
    }, 30_000);

    this.challengePollTimer = setInterval(() => {
      this.pollPendingChallenge();
      if (this.sentDuelId) this.pollSentDuel();
    }, 3_000);
  }

  private sendHeartbeat() {
    this.groupsService.duelHeartbeat(this.groupId).subscribe({ error: () => {} });
  }

  private pollOnlineMembers() {
    this.groupsService.duelOnline(this.groupId).subscribe({
      next: (r) => this.onlineMembers = r,
      error: () => {}
    });
  }

  private pollPendingChallenge() {
    // Skip if game is active, challenge already displayed, or we sent a challenge (we're the challenger)
    if (this.showDuelGame || this.pendingChallenge || this.sentDuelId) return;
    this.groupsService.duelPending(this.groupId).subscribe({
      next: (r) => this.pendingChallenge = r,
      error: () => {}
    });
  }

  isMemberOnline(userId: string): boolean {
    return userId !== this.currentUserId && this.onlineMembers.some(m => m.userId === userId);
  }

  challengeMember(userId: string) {
    const memoryIds = [...this.items]
      .sort(() => Math.random() - 0.5)
      .slice(0, 10)
      .map(m => m.id);
    this.challengeSentTo = userId;
    this.groupsService.duelChallenge(this.groupId, userId, memoryIds).subscribe({
      next: (r) => { this.sentDuelId = r.duelId; },
      error: () => { this.challengeSentTo = null; }
    });
  }

  private pollSentDuel() {
    if (!this.sentDuelId || this.showDuelGame) return;
    this.groupsService.duelState(this.groupId, this.sentDuelId).subscribe({
      next: (s) => {
        if (s.status === 'active') {
          this.activeDuelId = this.sentDuelId;
          this.activeDuelMemoryIds = s.memoryIds;
          this.sentDuelId = null;
          this.challengeSentTo = null;
          this.showDuelGame = true;
        } else if (s.status === 'declined') {
          const opponent = this.members.find(m => m.userId === this.challengeSentTo);
          const name = opponent?.name ?? 'Opponent';
          this.sentDuelId = null;
          this.challengeSentTo = null;
          clearTimeout(this.declinedMessageTimer);
          this.declinedByName = name;
          this.declinedMessageTimer = setTimeout(() => { this.declinedByName = null; }, 5000);
        } else if (s.status === 'finished') {
          this.sentDuelId = null;
          this.challengeSentTo = null;
        }
      },
      error: () => {}
    });
  }

  acceptChallenge() {
    if (!this.pendingChallenge) return;
    const duelId = this.pendingChallenge.duelId;
    this.groupsService.duelAccept(this.groupId, duelId).subscribe({
      next: (r) => {
        this.activeDuelId = duelId;
        this.activeDuelMemoryIds = r.memoryIds;
        this.pendingChallenge = null;
        this.showDuelGame = true;
      },
      error: () => {}
    });
  }

  declineChallenge() {
    if (!this.pendingChallenge) return;
    this.groupsService.duelDecline(this.groupId, this.pendingChallenge.duelId).subscribe({ error: () => {} });
    this.pendingChallenge = null;
  }

  onDuelGameClosed() {
    this.showDuelGame = false;
    this.activeDuelId = null;
    this.activeDuelMemoryIds = null;
    this.challengeSentTo = null;
    this.sentDuelId = null;
  }

  reload() {
    this.groupsService.memories(this.groupId, {
      type: this.fType === null ? undefined : this.fType,
      from: this.fFrom ? new Date(this.fFrom).toISOString() : undefined,
      to: this.fTo ? new Date(this.fTo).toISOString() : undefined,
      search: this.fSearch ? this.fSearch : undefined,
      sort: this.fSort,
      page: 1,
      pageSize: 50,
      albumId: this.selectedAlbumId ?? undefined,
    }).subscribe({
      next: (r) => this.items = r.items,
      error: (err) => console.error(err)
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  create() {
    const tags = this.cTags.split(',').map(x => x.trim()).filter(Boolean);

    // Quote memory => no file uploaded needed
    if (this.cType == 2) {
      const body = {
        type: this.cType,
        title: this.cTitle || null,
        quoteText: this.cType === 2 ? (this.cQuoteText || null) : null,
        quoteBy: this.cQuoteBy || null,
        mediaUrl: this.cType !== 2 ? (this.cMediaUrl || null) : null,
        thumbUrl: null,
        happenedAt: new Date(this.cHappenedAt).toISOString(),
        albumId: this.selectedAlbumId,
        tags
      };

      this.groupsService.createMemory(this.groupId, body).subscribe({
        next: () => this.afterCreate(),
        error: () => {}
      });

      return;
    }

    // Photo / Video => upload file

    if (!this.selectedFile) {
      alert("Please choose a photo/video file first!");
      return;
    }

    const data = {
      type: this.cType,
      title: this.cTitle || null,
      quoteText: null,
      happenedAt: new Date(this.cHappenedAt).toISOString(),
      albumId: this.selectedAlbumId,
      tags
    };

    this.groupsService.createMemoryWithFile(this.groupId, this.selectedFile, data).subscribe({
      next: () => this.afterCreate(),
      error: (err) => console.error(err)
    });
  }

  private afterCreate() {
    this.showCreate = false;
    this.cTitle = '';
    this.cQuoteText = '';
    this.cQuoteBy = '';
    this.cMediaUrl = '';
    this.cTags = '';
    this.selectedFile = null;
    this.reload();
  }

  typeLabel(t: number) {
    return t === 0 ? 'Photo' : t === 1 ? 'Video' : 'Quote';
  }

  cleanTags(tags: string[] | null | undefined): string[] {
    return (tags ?? [])
      .map(t => (t ?? '').trim())
      .filter(t => t.length > 0);
  }

  loadMembers() {
    this.groupsService.groupMembers(this.groupId).subscribe({
      next: (r) => {
        this.members = r;

        this.creatorName = this.group?.createdByUserName ?? 'Unknown';

        this.isAdmin = this.members.some(
          m => m.userId === this.currentUserId && m.role === 'Admin'
        );
      },
      error: (err) => console.error(err)
    });
  }

  loadStats() {
    this.groupsService.groupStats(this.groupId).subscribe({
      next: (r) => this.groupStats = r,
      error: (err) => console.error(err)
    });
  }

  loadActivity() {
    this.groupsService.weeklyActivity(this.groupId).subscribe({
      next: r => this.weeklyActivity = r,
      error: () => {}
    });
  }

  loadMemberActivity() {
    this.groupsService.memberActivity(this.groupId).subscribe({
      next: r => {
        this.memberActivity = r;

        this.mostActiveUserId = r.reduce((a, b) => a.totalMemories > b.totalMemories ? a : b).userId;
        this.topPhotoUserId = r.reduce((a, b) => a.photoCount > b.photoCount ? a : b).userId;
        this.topVideoUserId = r.reduce((a, b) => a.videoCount > b.videoCount ? a : b).userId;
        this.topQuoteUserId = r.reduce((a, b) => a.quoteCount > b.quoteCount ? a : b).userId;
      }
    });
  }

  // Tagging
  private getMentionContext(text: string) {
    const caret = text.length;
    const before = text.slice(0, caret);

    const atPos = before.lastIndexOf('@');
    if (atPos === -1) return null;

    const query = before.slice(atPos + 1);

    if (query.includes(' ')) return null;
    
    return { atPos, query }
  }

  updateMentionPopup() {
    const ctx = this.getMentionContext(this.cQuoteBy || '');
    if (!ctx) {
      this.showMentionPopup = false;
      return;
    }

    this.mentionQuery = ctx.query.toLowerCase();

    const all = this.members ?? [];

    this.mentionResults = all
      .filter(u => u.name.toLowerCase().includes(this.mentionQuery))
      .slice(0, 8);

    this.showMentionPopup = true;
    this.mentionIndex = Math.min(this.mentionIndex, this.mentionResults.length -1);
    if (this.mentionIndex < 0) this.mentionIndex = 0;
  }

  selectMention(u: { name: string }) {
    const ctx = this.getMentionContext(this.cQuoteBy || '');
    if (!ctx) return;

    const beforeAt = this.cQuoteBy.slice(0, ctx.atPos);
    this.cQuoteBy = `${beforeAt}@${u.name}`;
    this.showMentionPopup = false;
  }

  onQuoteByKeydown(event: KeyboardEvent) {
    if (!this.showMentionPopup) return;

    if (event.key == 'ArrowDown') {
      event.preventDefault();
      this.mentionIndex = Math.min(this.mentionIndex + 1, this.mentionResults.length - 1);
    }

    if (event.key == 'ArrowUp') {
      event.preventDefault();
      this.mentionIndex = Math.max(this.mentionIndex - 1, 0);
    }

    if (event.key == 'Enter') {
      event.preventDefault();
      const u = this.mentionResults[this.mentionIndex];
      if (u) this.selectMention(u);
    }

    if (event.key == 'Escape') {
      event.preventDefault();
      this.showMentionPopup = false;
    }
  }

  onQuoteByInput() {
    this.updateMentionPopup();
  }

  closeMentionPopup() {
    this.showMentionPopup = false;
  }

  // Albums
  loadAlbums() {
    this.groupsService.groupAlbums(this.groupId).subscribe({
      next: (r) => this.albums = r,
      error: (err) => console.error(err)
    });
  }

  goToAlbums() {
    this.router.navigate(['/groups', this.groupId, 'albums']);
  }

  // Stats
  timeSince(createdAt: string): string {
    const start = new Date(createdAt);
    if (Number.isNaN(start.getTime())) return '';

    const diffMs = Date.now() - start.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);

    const minute = 60;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    const rtf = this.getRelativeTimeFormat();
    if (!rtf) {
      // Fallback (English)
      const s = Math.max(diffSeconds, 1);
      if (diffSeconds < minute) return `${s} second${s === 1 ? '' : 's'} ago`;
      if (diffSeconds < hour) {
        const m = Math.floor(diffSeconds / minute);
        return `${m} minute${m === 1 ? '' : 's'} ago`;
      }
      if (diffSeconds < day) {
        const h = Math.floor(diffSeconds / hour);
        return `${h} hour${h === 1 ? '' : 's'} ago`;
      }
      if (diffSeconds < week) {
        const d = Math.floor(diffSeconds / day);
        return `${d} day${d === 1 ? '' : 's'} ago`;
      }
      if (diffSeconds < month) {
        const w = Math.floor(diffSeconds / week);
        return `${w} week${w === 1 ? '' : 's'} ago`;
      }
      if (diffSeconds < year) {
        const mo = Math.floor(diffSeconds / month);
        return `${mo} month${mo === 1 ? '' : 's'} ago`;
      }
      const y = Math.floor(diffSeconds / year);
      return `${y} year${y === 1 ? '' : 's'} ago`;
    }

    if (diffSeconds < minute) {
      const s = Math.max(diffSeconds, 1);
      return rtf.format(-s, 'second');
    }

    // Minutes
    if (diffSeconds < hour) {
      const m = Math.floor(diffSeconds / minute);
      return rtf.format(-m, 'minute');
    }

    if (diffSeconds < day) {
      const h = Math.floor(diffSeconds / hour);
      return rtf.format(-h, 'hour');
    }

    if (diffSeconds < week) {
      const d = Math.floor(diffSeconds / day);
      return rtf.format(-d, 'day');
    }

    if (diffSeconds < month) {
      const w = Math.floor(diffSeconds / week);
      return rtf.format(-w, 'week');
    }

    if (diffSeconds < year) {
      const mo = Math.floor(diffSeconds / month);
      return rtf.format(-mo, 'month');
    }

    const y = Math.floor(diffSeconds / year);
    return rtf.format(-y, 'year');
  }

  goToAdmin() {
    this.router.navigate(['/groups', this.groupId, 'admin']);
  }

  private getRelativeTimeFormat(): Intl.RelativeTimeFormat | null {
    if (typeof Intl === 'undefined' || !Intl.RelativeTimeFormat) return null;
    const lang: AppLanguage = this.i18n.currentLanguage;
    return new Intl.RelativeTimeFormat(lang, { numeric: 'always' });
  }
}
