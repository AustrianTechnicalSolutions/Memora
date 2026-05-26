import { Component, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { GroupsService, AlbumDto, MemoryDto, AlbumPersonDto, CommentDto } from '../../groups';
import { TranslatePipe } from '../../../translation/translate.pipe';
import { I18nService } from '../../../translation/i18n.service';
import { environment } from '../../../../environment';
import * as exifr from 'exifr';
import { AuthService } from '../../../user/auth.service';
import { DrawingCanvasComponent } from '../../drawing-canvas/drawing-canvas';

@Component({
  selector: 'app-album-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, TranslatePipe, DrawingCanvasComponent],
  templateUrl: './album-detail.html',
  styleUrls: ['./album-detail.css']
})
export class AlbumDetailComponent implements OnDestroy {
  @ViewChild(DrawingCanvasComponent) drawingCanvas?: DrawingCanvasComponent;


  private readonly backendOrigin = `${window.location.protocol}//${window.location.hostname}:5000`;
  groupId!: string;
  albumId!: string;

  album?: AlbumDto;
  items: MemoryDto[] = [];

  // Memory viewer + comments
  showMemoryModal = false;
  activeMemory: MemoryDto | null = null;
  comments: CommentDto[] = [];
  topLevelComments: CommentDto[] = [];
  replyMap: { [key: string]: CommentDto[] } = {};
  commentText = '';
  replyTo: CommentDto | null = null;
  commentsLoading = false;

  newType: number = 0;
  newTitle = '';
  newQuoteText = '';
  newDate = new Date().toISOString().slice(0, 10);
  selectedFile?: File;

  // Mentioning
  members: { userId: string, name: string; role: string; avatarUrl: string; }[] = [];
  memberById: { [key: string]: { name: string; avatarUrl?: string | null } } = {};
  activeUploader: { name: string; avatarUrl?: string | null } | null = null;
  newQuoteBy = '';
  showMentionPopup = false;
  mentionQuery = '';
  mentionResults: { userId: string, name: string; role: string }[] = [];
  mentionIndex = 0;

  // Media tagging (multi)
  taggedUserIds: string[] = [];
  freeTextPeople: string[] = [];
  mediaTagInput = '';

  // Adding a memory
  showAddMemoryModal = false;
  addStep: 'choose' | 'media' | 'quote' | 'draw' = 'choose';
  mediaType: 'photo' | 'video' = 'photo';
  previewUrl: string | null = null;
  failedMedia = new Set<string>();

  // Adding people
  albumPeople: AlbumPersonDto[] = [];
  canEditAlbum = false;
  showAddPersonModal = false;
  personQuery = '';
  personResults: { userId: string; name: string; role: string; avatarUrl?: string | null }[] = [];

  // Security
  imageSrcMap = new Map<string, string>();
  loadingSet = new Set<string>();

  // Metadata
  newLocationName = '';
  autoLat?: number;
  autoLong?: number;
  useGps = true;
  autoTime?: Date;

  // Searching
  searchQuery = '';
  filteredItems: MemoryDto[] = [];

  // Delete a memory
  currentUserId: string | null = null;
  isAdmin = false;
  isPreparingRandomMemory = false;
  randomMemoryStatus = '';
  private randomMemoryTimer?: number;

  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private groupsService: GroupsService,
    private i18n: I18nService,
    private http: HttpClient,
    private auth: AuthService
  ) {}

  ngOnInit() {
    this.groupId = this.route.snapshot.paramMap.get('id')!;
    this.albumId = this.route.snapshot.paramMap.get('albumId')!;
    
    this.auth.currentUser().subscribe(u => {
      this.currentUserId = u.id;
      this.updateAdminState();
    });

    this.loadAlbum();
    this.loadAlbumPeople();
    this.loadMemories();
    this.loadMembers();

    this.refreshTimer = setInterval(() => this.refreshCounts(), 10_000);
  }

  ngOnDestroy() {
    clearInterval(this.refreshTimer);
  }

  // Polls server every 10s and syncs the full memory list:
  // - adds new memories posted by other users (+ loads their media)
  // - removes memories deleted by others
  // - patches likeCount / commentCount / isLiked in-place (no media re-download)
  // - refreshes comments silently when the modal is open
  private refreshCounts() {
    const query: any = { sort: 'newest', page: 1, pageSize: 50 };
    if (this.albumId !== 'all') query.albumId = this.albumId;

    this.groupsService.memories(this.groupId, query).subscribe({
      next: (r) => {
        const serverById = new Map(r.items.map(m => [m.id, m]));
        const localById  = new Map(this.items.map(m => [m.id, m]));

        // 1. Patch existing items in-place (no flicker, no media re-fetch)
        for (const item of this.items) {
          const fresh = serverById.get(item.id);
          if (fresh) {
            item.likeCount    = fresh.likeCount;
            item.commentCount = fresh.commentCount;
            item.isLiked      = fresh.isLiked;
          }
        }

        // 2. Add memories that appeared since last poll
        for (const fresh of r.items) {
          if (!localById.has(fresh.id)) {
            this.items.unshift(fresh);
            // Trigger media blob load for photo/video memories
            if (fresh.type === 0 || fresh.type === 1) {
              this.loadMedia(fresh.mediaUrl);
            }
          }
        }

        // 3. Remove memories that were deleted on the server
        this.items = this.items.filter(m => serverById.has(m.id));

        // 4. Keep filteredItems in sync (re-apply current search)
        this.applySearch();

        // 5. Update open modal memory
        if (this.activeMemory) {
          const fresh = serverById.get(this.activeMemory.id);
          if (fresh) {
            this.activeMemory.likeCount    = fresh.likeCount;
            this.activeMemory.commentCount = fresh.commentCount;
            this.activeMemory.isLiked      = fresh.isLiked;
          }
        }
      },
      error: () => {}
    });

    // 6. Silently refresh comments when the modal is open
    if (this.showMemoryModal && this.activeMemory) {
      this.silentRefreshComments();
    }
  }

  // Refreshes comments without showing a loading indicator or resetting the text input.
  private silentRefreshComments() {
    if (!this.activeMemory) return;

    this.groupsService.memoryComments(this.groupId, this.activeMemory.id).subscribe({
      next: (r) => {
        // Only rebuild tree if something actually changed (count or last id)
        const changed =
          r.length !== this.comments.length ||
          (r.length > 0 && r[r.length - 1]?.id !== this.comments[this.comments.length - 1]?.id);

        if (changed) {
          this.comments = r;
          this.rebuildCommentTree();
          this.activeMemory!.commentCount = r.length;
        }
      },
      error: () => {}
    });
  }

  backToAlbums() {
    this.router.navigate(['/groups', this.groupId, 'albums']);
  }

  loadAlbum() {
    if (this.albumId == 'all') {
      this.album = {
        id: 'all',
        groupId: this.groupId,
        title: this.i18n.translate('albums.allMemories'),
        description: this.i18n.translate('albums.collections'),
        dateStart: new Date(0).toISOString(),
        dateEnd: null,
        memoryCount: 0
      };
      return;
    }
    
    this.groupsService.groupAlbums(this.groupId).subscribe({
      next: (albums) => {
        this.album = albums.find(a => a.id === this.albumId);

        this.canEditAlbum = true;
      },
      error: (err) => console.error(err)
    });
  }

  loadMemories() {
    const query: any = {
      sort: 'newest',
      page: 1,
      pageSize: 50
    }

    if (this.albumId != 'all') query.albumId = this.albumId;
    
    this.groupsService.memories(this.groupId, query).subscribe({
      next: (r) => {
        this.items = r.items;

        this.items.forEach(m => {
          if (m.type === 0 || m.type === 1) {
            this.loadMedia(m.mediaUrl);
          }
        });

        this.items = r.items;
        this.filteredItems = [...this.items];
      },
      error: (err) => console.error(err)
    });
  }

  loadMembers() {
    this.groupsService.groupMembers(this.groupId).subscribe({
      next: (r) => {
        this.members = r;

        this.memberById = r.reduce((acc, m) => {
          acc[m.userId] = { name: m.name, avatarUrl: m.avatarUrl ?? null };
          return acc;
        }, {} as { [key: string]: { name: string; avatarUrl?: string | null } });

        this.updateAdminState();
        this.updateActiveUploader();
      },
      error: (err) => console.error(err)
    });
  }

  private updateAdminState() {
    this.isAdmin = this.members.some(
      m => m.userId === this.currentUserId && m.role === 'Admin'
    );
  }

  loadMedia(url?: string | null) {
    if (!url || this.imageSrcMap.has(url) || this.loadingSet.has(url)) return;

    this.loadingSet.add(url);

    const fullUrl = environment.apiUrl + url;

    this.http.get(fullUrl, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const objectUrl = URL.createObjectURL(blob);
        this.imageSrcMap.set(url, objectUrl);
        this.loadingSet.delete(url);
      },
      error: (err) => {
        console.error('Media load failed', err);
        this.loadingSet.delete(url);
      }
    });
  }

  openMemory(m: MemoryDto) {
    this.activeMemory = m;
    this.updateActiveUploader();
    this.showMemoryModal = true;
    this.commentText = '';
    this.replyTo = null;
    this.loadComments();
  }

  openRandomMemory() {
    if (this.isPreparingRandomMemory) return;

    const pool = this.filteredItems.length > 0 ? this.filteredItems : this.items;

    if (!pool.length) return;

    const statusMessages = [
      'Shuffling through the album for a hidden gem...',
      'Picking a memory at random...',
      'Dusting off a surprise worth revisiting...',
      'Revealing something unexpected...'
    ];

    this.isPreparingRandomMemory = true;
    this.randomMemoryStatus = statusMessages[Math.floor(Math.random() * statusMessages.length)];

    if (this.randomMemoryTimer) {
      window.clearTimeout(this.randomMemoryTimer);
    }

    this.randomMemoryTimer = window.setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * pool.length);
      this.isPreparingRandomMemory = false;
      this.randomMemoryStatus = '';
      this.openMemory(pool[randomIndex]);
    }, 1800);
  }

  ngOnDestroy() {
    if (this.randomMemoryTimer) {
      window.clearTimeout(this.randomMemoryTimer);
    }
  }

  closeMemory() {
    this.showMemoryModal = false;
    this.activeMemory = null;
    this.activeUploader = null;
    this.comments = [];
    this.topLevelComments = [];
    this.replyMap = {};
    this.commentText = '';
    this.replyTo = null;
    this.commentsLoading = false;
  }

  private updateActiveUploader() {
    if (!this.activeMemory) {
      this.activeUploader = null;
      return;
    }

    const found = this.memberById[this.activeMemory.createdByUserId];
    this.activeUploader = found
      ? { name: found.name, avatarUrl: found.avatarUrl ?? null }
      : { name: this.i18n.translate('album.unknownUser'), avatarUrl: null };
  }

  loadComments() {
    if (!this.activeMemory) return;

    this.commentsLoading = true;
    this.groupsService.memoryComments(this.groupId, this.activeMemory.id).subscribe({
      next: (r) => {
        this.comments = r;
        this.rebuildCommentTree();
        this.commentsLoading = false;
        this.activeMemory!.commentCount = this.comments.length;
      },
      error: (err) => {
        console.error(err);
        this.commentsLoading = false;
      }
    });
  }

  private rebuildCommentTree() {
    const top: CommentDto[] = [];
    const map: { [key: string]: CommentDto[] } = {};
    const byId = new Map<string, CommentDto>();

    for (const c of this.comments) {
      byId.set(c.id, c);
    }

    const rootIdFor = (comment: CommentDto): string => {
      let current: CommentDto = comment;
      const seen = new Set<string>();

      while (current.parentCommentId && byId.has(current.parentCommentId)) {
        if (seen.has(current.parentCommentId)) break;
        seen.add(current.parentCommentId);
        current = byId.get(current.parentCommentId)!;
      }

      return current.id;
    };

    for (const c of this.comments) {
      if (c.parentCommentId) {
        const rootId = rootIdFor(c);
        if (!map[rootId]) map[rootId] = [];
        map[rootId].push(c);
      } else {
        top.push(c);
      }
    }

    const byDate = (a: CommentDto, b: CommentDto) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    top.sort(byDate);
    Object.keys(map).forEach(k => map[k].sort(byDate));

    this.topLevelComments = top;
    this.replyMap = map;
  }

  submitComment() {
    if (!this.activeMemory) return;

    const content = (this.commentText || '').trim();
    if (!content) return;

    this.groupsService.addComment(this.groupId, this.activeMemory.id, {
      content,
      parentCommentId: this.replyTo?.id ?? null
    }).subscribe({
      next: (comment) => {
        this.comments = [...this.comments, comment];
        this.rebuildCommentTree();
        this.commentText = '';
        this.replyTo = null;
        this.activeMemory!.commentCount = (this.activeMemory!.commentCount || 0) + 1;
      },
      error: (err) => console.error(err)
    });
  }

  setReply(target: CommentDto) {
    this.replyTo = target;
  }

  cancelReply() {
    this.replyTo = null;
  }

  toggleMemoryLike(m: MemoryDto, event?: Event) {
    if (event) event.stopPropagation();

    if (m.isLiked) {
      this.groupsService.unlikeMemory(this.groupId, m.id).subscribe({
        next: () => {
          m.isLiked = false;
          m.likeCount = Math.max(0, (m.likeCount || 0) - 1);
        },
        error: (err) => console.error(err)
      });
    } else {
      this.groupsService.likeMemory(this.groupId, m.id).subscribe({
        next: () => {
          m.isLiked = true;
          m.likeCount = (m.likeCount || 0) + 1;
        },
        error: (err) => console.error(err)
      });
    }
  }

  toggleCommentLike(c: CommentDto, event?: Event) {
    if (event) event.stopPropagation();

    if (c.isLiked) {
      this.groupsService.unlikeComment(this.groupId, c.id).subscribe({
        next: () => {
          c.isLiked = false;
          c.likeCount = Math.max(0, (c.likeCount || 0) - 1);
        },
        error: (err) => console.error(err)
      });
    } else {
      this.groupsService.likeComment(this.groupId, c.id).subscribe({
        next: () => {
          c.isLiked = true;
          c.likeCount = (c.likeCount || 0) + 1;
        },
        error: (err) => console.error(err)
      });
    }
  }

  typeLabel(t: number) {
    return t === 0 ? 'Photo' : t === 1 ? 'Video' : 'Quote';
  }

  cleanTags(tags: string[] | null | undefined): string[] {
    return (tags ?? [])
      .map(t => (t ?? '').trim())
      .filter(t => t.length > 0);
  }

  createMemory() {
    // Resolve tagged user IDs to display names so the backend stores names, not UUIDs
    const resolvedPeople = [
      ...this.taggedUserIds.map(id => this.memberById[id]?.name ?? id),
      ...this.freeTextPeople,
    ];

    const baseData: any = {
      type: this.newType,
      title: this.newTitle || null,
      quoteText: this.newType === 2 ? this.newQuoteText : null,
      quoteBy: this.newType === 2 ? (this.newQuoteBy || null) : null,
      happenedAt: new Date(this.newDate).toISOString(),
      tags: [],
      people: resolvedPeople,
      albumId: this.albumId !== 'all' ? this.albumId : null,

      location: this.newLocationName ?? null,
      latitude: this.useGps ? (this.autoLat ?? null) : null,
      longitude: this.useGps ? (this.autoLong ?? null) : null,
    };

    if (this.newType === 2) {
      // Quote (no file)
      this.groupsService.createMemory(this.groupId, baseData).subscribe({
        next: () => this.afterCreate(),
        error: err => console.error(err)
      });
    } else {
      // Photo or video
      if (!this.selectedFile) {
        alert(this.i18n.translate('album.selectFile'));
        return;
      }

      this.groupsService
        .createMemoryWithFile(this.groupId, this.selectedFile, baseData)
        .subscribe({
          next: () => this.afterCreate(),
          error: err => console.error(err)
        });
    }
  }

  afterCreate() {
    this.newTitle = '';
    this.newQuoteText = '';
    this.selectedFile = undefined;
    this.previewUrl = null;
    this.loadMemories();
    this.newQuoteBy = '';
    this.showMentionPopup = false;
    this.taggedUserIds = [];
    this.freeTextPeople = [];
    this.mediaTagInput = '';
  }

  // Mentioning
  private getMentionContext(text: string) {
    const caret = text.length;
    const before = text.slice(0, caret);

    const atPos = before.lastIndexOf('@');
    if (atPos === -1) return null;

    const query = before.slice(atPos + 1);
    if (query.includes(' ')) return null;

    return { atPos, query };
  }

  updateMentionPopup() {
    const ctx = this.getMentionContext(this.newQuoteBy || '');
    if (!ctx) {
      this.showMentionPopup = false;
      return;
    }

    this.mentionQuery = ctx.query.toLowerCase();

    this.mentionResults = this.members
      .filter(u => u.name.toLowerCase().includes(this.mentionQuery))
      .slice(0, 8);

    this.showMentionPopup = true;
    this.mentionIndex = Math.min(
      this.mentionIndex,
      this.mentionResults.length - 1
    );
    if (this.mentionIndex < 0) this.mentionIndex = 0;
  }

  selectMention(u: { name: string }) {
    const ctx = this.getMentionContext(this.newQuoteBy || '');
    if (!ctx) return;

    const beforeAt = this.newQuoteBy.slice(0, ctx.atPos);
    this.newQuoteBy = `${beforeAt}@${u.name}`;
    this.showMentionPopup = false;
  }

  onQuoteByKeydown(event: KeyboardEvent) {
    if (!this.showMentionPopup) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.mentionIndex = Math.min(
        this.mentionIndex + 1,
        this.mentionResults.length - 1
      );
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.mentionIndex = Math.max(this.mentionIndex - 1, 0);
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const u = this.mentionResults[this.mentionIndex];
      if (u) this.selectMention(u);
    }

    if (event.key === 'Escape') {
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

  openAddMemory() {
    this.showAddMemoryModal = true;
    this.addStep = 'choose';
  }

  async onFileSelected(e: any) {
    const file = e.target.files?.[0];
    if (!file) return;

    this.selectedFile = file;
    this.previewUrl = URL.createObjectURL(file);  

    try {
      const meta: any = await exifr.parse(file);

      // GPS
      if (meta?.latitude && meta?.longitude)  {
        this.autoLat = meta.latitude;
        this.autoLong = meta.longitude;

        this.useGps = true;
      } else {
        this.autoLat = undefined;
        this.autoLong = undefined;
      }

    } catch (err) {
      console.warn('No EXIF metadata found');
      this.autoLat = undefined;
      this.autoLong = undefined;
    }
  }

  submitMedia() {
    if (!this.selectedFile) {
      alert(this.i18n.translate('album.selectFile'));
      return;
    }

    this.newType = this.mediaType === 'photo' ? 0 : 1;

    this.createMemory();
    this.showAddMemoryModal = false;
  }

  submitQuote() {
    this.newType = 2;

    if (!this.newQuoteText) {
      alert(this.i18n.translate('album.writeQuote'));
      return;
    }

    this.createMemory();
    this.showAddMemoryModal = false;
  }

  exportDrawing() {
    this.drawingCanvas?.export();
  }

  submitDrawing(file: File) {
    const data = {
      type: 0,
      title: 'Drawing',
      quoteText: null,
      happenedAt: new Date().toISOString(),
      albumId: this.albumId !== 'all' ? this.albumId : null,
      tags: [],
      people: [],
    };

    this.groupsService.createMemoryWithFile(this.groupId, file, data).subscribe({
      next: () => {
        this.showAddMemoryModal = false;
        this.loadMemories();
      },
      error: (err) => console.error(err)
    });
  }

  isImage(url: string | null | undefined): boolean {
    if (!url) return false;
    const result = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
    console.log("Image? " + result + "    " + url)
    return result;
  }

  isVideo(url: string | null | undefined): boolean {
    if (!url) return false;
    return /\.(mp4|webm|mov)$/i.test(url);
  }

  mediaSrc(url?: string | null): string | null {
    if (!url) return null;

    const token = localStorage.getItem('token');

    return `${environment.apiUrl}${url}?token=${token}`;
  }

  mediaFailed(url: string | null | undefined): boolean {
    return !!url && this.failedMedia.has(url);
  }

  onMediaError(url: string | null | undefined) {
    if (url) this.failedMedia.add(url);
  }

  // People in Album
  loadAlbumPeople() {
    if (this.albumId === 'all') return;

    this.groupsService.albumPeople(this.groupId, this.albumId)
      .subscribe(r => this.albumPeople = r);
  }

  openAddPerson() {
    this.showAddPersonModal = true;
    this.personQuery = '';
    this.updatePersonResults();
  }

  closeAddPerson() {
    this.showAddPersonModal = false;
  }

  updatePersonResults() {
    const q = (this.personQuery || '').trim().toLowerCase();

    // Only show group members not already in albumPeople
    const already = new Set(this.albumPeople.map(p => p.userId));

    this.personResults = this.members
      .filter(m => !already.has(m.userId))
      .filter(m => !q || m.name.toLowerCase().includes(q))
      .slice(0, 20);
  }

  addPersonToAlbum(userId: string) {
    if (this.albumId === 'all') return;

    this.groupsService.addAlbumPerson(this.groupId, this.albumId, userId).subscribe({
      next: () => {
        this.personResults = this.personResults.filter(
          u => u.userId !== userId
        );

        const added = this.members.find(m => m.userId === userId);
        if (added) {
          this.albumPeople = [
            ...this.albumPeople,
            {
              userId: added.userId,
              name: added.name,
              role: added.role,
              avatarUrl: added.avatarUrl ?? null
            }
          ];
        }

        this.loadAlbumPeople();
      },
      error: err => console.error(err)
    });
  }

  removePerson(userId: string) {
    this.groupsService
      .removeAlbumPerson(this.groupId, this.albumId, userId)
      .subscribe({
        next: () => {
          this.albumPeople = this.albumPeople.filter(
            p => p.userId !== userId
          );

          this.updatePersonResults();
        },
        error: err => console.error(err)
      });
  }

  // Mentioning in media
  onMediaTagInput() {
    const ctx = this.getMentionContext(this.mediaTagInput || '');
    if (!ctx) {
      this.showMentionPopup = false;
      return;
    }

    this.mentionQuery = ctx.query.toLowerCase();

    this.mentionResults = this.members
      .filter(u =>
        u.name.toLowerCase().includes(this.mentionQuery) &&
        !this.taggedUserIds.includes(u.userId) // prevent duplicates
      )
      .slice(0, 8);

    this.showMentionPopup = true;
    this.mentionIndex = 0;
  }

  selectMediaTag(u: { userId: string; name: string }) {
    if (!this.taggedUserIds.includes(u.userId)) {
      this.taggedUserIds.push(u.userId);
    }

    this.mediaTagInput = '';
    this.showMentionPopup = false;
  }

  onMediaTagKeydown(event: KeyboardEvent) {
    if (!this.showMentionPopup) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.mentionIndex = Math.min(this.mentionIndex + 1, this.mentionResults.length - 1);
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.mentionIndex = Math.max(this.mentionIndex - 1, 0);
    }

    if (event.key === 'Enter') {
      if (event.key === 'Enter') {
        const u = this.mentionResults[this.mentionIndex];

        if (u) {
          this.selectMediaTag(u);
        } else {
          this.addFreeTextPerson(this.mediaTagInput);
        }

        event.preventDefault();
      }
    }

    if (event.key === 'Escape') {
      this.showMentionPopup = false;
    }
  }

  removeTaggedUser(userId: string) {
    this.taggedUserIds = this.taggedUserIds.filter(id => id !== userId);
  }

  getTaggedUsers(memory: MemoryDto) {
    return (memory.people || [])
      .map(id => ({
        userId: id,
        name: this.memberById[id]?.name || 'Unknown',
        avatarUrl: this.memberById[id]?.avatarUrl || null
      }));
  }

  addFreeTextPerson(name: string) {
    const clean = name.trim();
    if (!clean) return;

    if (!this.freeTextPeople.includes(clean)) {
      this.freeTextPeople.push(clean);
    }

    this.mediaTagInput = '';
  }

  // Searching
  applySearch() {
    const tokens = this.tokenize(this.searchQuery);

    if (!tokens.length) {
      this.filteredItems = [...this.items];
      return;
    }

    const scored = this.items.map(m => ({
      memory: m,
      score: this.scoreMemory(m, tokens)
    }));

    this.filteredItems = scored
      .filter(x => x.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .map(x => x.memory);
  }

  tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean);
  }

  classifyToken(token: string) {
    if (this.members.some(m => m.name.toLowerCase().includes(token))) {
      return 'person';
    }

    if (this.isLocation(token)) {
      return 'place';
    }

    if (this.isTimeWord(token)) {
      return 'time';
    }

    return 'tag';
  }

  isLocation(token: string) {
    return [''] // Fill up later
  }

  isTimeWord(token: string) {
    return [''] // Fill up later
  }

  scoreMemory(memory: MemoryDto, tokens: string[]): number {
    let totalScore = 0;
    let matchedTokens = 0;

    for (const token of tokens) {
      // People
      // We try to match the input with a person. If a token is 100% a person,
      // we, ignore everything else and only look for that.
      console.log("t")
      if (memory.people) {
        memory.people.forEach(p => {
          console.log(p)
          const personMatch = this.bestMatch(this.memberById[p].name || '', token);
          if (personMatch > 0.95) { // You normally dont misspell names
            matchedTokens++;
            totalScore += personMatch;
          }
        })
      }

      // Title and location
      const titleMatch = this.bestMatch(memory.title || '', token);
      const locationMatch = this.bestMatch(memory.locationName || '', token);
      const cityMatch = this.bestMatch(memory.locationCity || '', token);
      const countryMatch = this.bestMatch(memory.locationCountry || '', token);

      if (titleMatch > 0.8) {
        matchedTokens++;
        totalScore += titleMatch * 1.5; // Higher value for title
        console.log(titleMatch, totalScore);
      } else if (locationMatch > 0.6) {
        matchedTokens++;
        totalScore += locationMatch;
      } else if (cityMatch > 0.8) {
        matchedTokens++;
        totalScore += cityMatch * 0.7;
      } else if (countryMatch > 0.8) {
        matchedTokens++;
        totalScore += countryMatch * 0.7;
      }
    }

    const ratio = matchedTokens / tokens.length;

    if (ratio <= 0.7) return 0;

    return totalScore;
  }

  similarity(a: string, b: string): number {
    if (!a || !b) return 0;

    a = a.toLowerCase();
    b = b.toLowerCase();

    if (a.includes(b)) return 1;

    const dist = this.levensthein(a, b);
    const maxLen = Math.max(a.length, b.length);

    return 1 - dist / maxLen;
  }

  bestMatch(text: string, token: string): number {
    if (!text) return 0;

    const words = text.toLowerCase().split(/\s+/);

    let best = 0;

    for (const w of words) {
      const sim = this.similarity(w, token);
      if (sim > best) best = sim;
    }

    return best;
  }

  matchesTime(dateStr: string, token: string): boolean {
    const d = new Date(dateStr);

    if (token === 'summer')   return d.getMonth() >= 5 && d.getMonth() <= 7;
    // Need more

    return false;
  }

  levensthein(a: string, b: string) {
    const m = a.length;
    const n = b.length;

    // Create matrix
    const dp: number[][] = Array.from({ length: m + 1 }, () => 
      new Array(n + 1).fill(0)
    );

    // Initialize edges
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;

        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[m][n];
  }

  // Removing memories
  canRemoveMemory(memory: MemoryDto): boolean {
    return this.isAdmin || memory.createdByUserId === this.currentUserId;
  }

  removeMemory(memory: MemoryDto, event?: Event) {
    event?.stopPropagation();

    if (!this.canRemoveMemory(memory)) return;

    if (!confirm('Remove this memory?')) return;

    this.groupsService.deleteMemory(this.groupId, memory.id).subscribe({
      next: () => {
        this.items = this.items.filter(m => m.id !== memory.id);
        this.filteredItems = this.filteredItems.filter(m => m.id !== memory.id);

        if (this.activeMemory?.id === memory.id) {
          this.closeMemory();
        }
      },
      error: err => console.error(err)
    });
  }
}
