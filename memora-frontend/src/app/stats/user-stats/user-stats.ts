import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { GroupsService, MemoryDto } from '../../groups/groups';
import { TranslatePipe } from '../../translation/translate.pipe';
import { I18nService } from '../../translation/i18n.service';
import { environment } from '../../../environment';

interface UserMeDto {
  id: string;
  displayName: string;
}

interface StatTile {
  id: string;
  label: string;
  value: string;
  description?: string;
  hint?: string;
  placeholder?: boolean;
  tone?: 'primary' | 'accent' | 'soft';
}

interface GroupSummary {
  id: string;
  name: string;
}

@Component({
  selector: 'app-user-stats-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './user-stats.html',
  styleUrls: ['./user-stats.css']
})
export class UserStatsPageComponent {
  private readonly preferenceKey = 'memora.user-stats.preferences';
  private baseUrl = `${environment.apiUrl}/api/account`;

  loading = true;
  error = '';

  isGroupMode = false;
  groupId: string | null = null;
  groupName = '';
  userDisplayName = 'You';

  tiles: StatTile[] = [];
  groupSwitchLinks: GroupSummary[] = [];

  activityBars = [
    { label: 'Quotes', value: 0 },
    { label: 'Photos', value: 0 },
    { label: 'Videos', value: 0 }
  ];

  showCustomizePanel = false;
  visibleTileIds = new Set<string>();
  showDistribution = true;
  showGroupSwitcher = true;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly http: HttpClient,
    private readonly groupsService: GroupsService,
    private readonly i18n: I18nService,
    private router: Router
  ) {}

  ngOnInit() {
    this.groupId = this.route.snapshot.paramMap.get('id');
    this.isGroupMode = !!this.groupId;
    this.loadPreferences();
    this.load();
  }

  get visibleTiles(): StatTile[] {
    return this.tiles.filter((tile) => this.visibleTileIds.has(tile.id));
  }

  get totalPosts(): number {
    return this.activityBars.reduce((sum, bar) => sum + bar.value, 0);
  }

  get visibleTileCount(): number {
    return this.visibleTiles.length;
  }

  private load() {
    this.loading = true;
    this.error = '';

    this.http.get<UserMeDto>(`${this.baseUrl}/me`).pipe(
      switchMap((me) => {
        this.userDisplayName = me.displayName?.trim() || 'You';

        if (this.groupId) {
          return forkJoin({
            group: this.groupsService.groupDetail(this.groupId),
            memories: this.collectGroupMemories(this.groupId)
          }).pipe(
            map(({ group, memories }) => {
              this.groupName = group.name;
              this.groupSwitchLinks = [{ id: group.id, name: group.name }];
              return this.computeStats(memories, me.id, true);
            })
          );
        }

        return this.groupsService.myGroups().pipe(
          switchMap((groups) => {
            this.groupSwitchLinks = groups.map((g) => ({ id: g.id, name: g.name }));

            if (groups.length === 0) {
              return of(this.computeStats([], me.id, false));
            }

            return forkJoin(
              groups.map((g) => this.collectGroupMemories(g.id))
            ).pipe(
              map((memoryBatches) => this.computeStats(memoryBatches.flat(), me.id, false))
            );
          })
        );
      }),
      catchError((err) => {
        console.error(err);
        this.error = this.i18n.translate('stats.loadFailed');
        return of(null);
      })
    ).subscribe((result) => {
      if (result) {
        this.tiles = result.tiles;
        this.activityBars = result.bars;
        this.ensureVisibleTiles();
      }

      this.loading = false;
    });
  }

  private collectGroupMemories(groupId: string) {
    const firstPage = 1;
    const pageSize = 100;

    return this.groupsService.memories(groupId, {
      page: firstPage,
      pageSize,
      sort: 'newest'
    }).pipe(
      catchError((err) => {
        console.error('Failed to load group memories', err);
        return of([]);
      }),
      switchMap((first) => {
        if (!('total' in first)) {
          return of(first as MemoryDto[]);
        }
        const totalPages = Math.max(1, Math.ceil(first.total / pageSize));
        if (totalPages === 1) {
          return of(first.items);
        }

        const followUps = Array.from({ length: totalPages - 1 }, (_, idx) =>
          this.groupsService.memories(groupId, {
            page: idx + 2,
            pageSize,
            sort: 'newest'
          }).pipe(map((r) => r.items))
        );

        return forkJoin(followUps).pipe(
          map((pages) => [first.items, ...pages].flat())
        );
      })
    );
  }

  private computeStats(memories: MemoryDto[], userId: string, isGroup: boolean) {
    const own = memories.filter((m) => m.createdByUserId === userId);
    const quoteCount = own.filter((m) => m.type === 2).length;
    const photoCount = own.filter((m) => m.type === 0).length;
    const videoCount = own.filter((m) => m.type === 1).length;
    const postCount = own.length;

    const likesTotal = own.reduce((sum, m) => sum + (m.likeCount ?? 0), 0);
    const likesPerPost = postCount === 0 ? 0 : likesTotal / postCount;

    const groupPosts = memories.length;
    const contributionShare = groupPosts === 0 ? 0 : (postCount / groupPosts) * 100;

    const scopeLabel = isGroup
      ? this.i18n.translate('stats.scopeSingleGroup')
      : this.i18n.translate('stats.scopeAllGroups');

    const tiles: StatTile[] = [
      {
        id: 'posts',
        label: this.i18n.translate('stats.posts'),
        value: `${postCount}`,
        description: scopeLabel,
        tone: 'primary'
      },
      {
        id: 'quotes',
        label: this.i18n.translate('stats.quotes'),
        value: `${quoteCount}`,
        description: this.i18n.translate('stats.byYou'),
        tone: 'soft'
      },
      {
        id: 'likesTotal',
        label: this.i18n.translate('stats.likesTotal'),
        value: `${likesTotal}`,
        description: scopeLabel,
        tone: 'accent'
      },
      {
        id: 'likesRatio',
        label: this.i18n.translate('stats.likesPerPost'),
        value: likesPerPost.toFixed(2),
        description: this.i18n.translate('stats.likesAverage'),
        tone: 'accent'
      },
      {
        id: 'photos',
        label: this.i18n.translate('stats.photos'),
        value: `${photoCount}`,
        description: this.i18n.translate('stats.photosArchive'),
        tone: 'soft'
      },
      {
        id: 'videos',
        label: this.i18n.translate('stats.videos'),
        value: `${videoCount}`,
        description: this.i18n.translate('stats.videosArchive'),
        tone: 'soft'
      },
      {
        id: 'share',
        label: this.i18n.translate('stats.share'),
        value: `${contributionShare.toFixed(1)}%`,
        description: isGroup
          ? this.i18n.translate('stats.shareGroup')
          : this.i18n.translate('stats.shareAll'),
        tone: 'primary'
      }
    ];

    if (isGroup) {
      tiles.push({
        id: 'groupShareExtra',
        label: 'Anteil deiner Posts',
        value: `${contributionShare.toFixed(1)}%`
      });
    }

    const bars = [
      { label: 'Quotes', value: quoteCount },
      { label: 'Photos', value: photoCount },
      { label: 'Videos', value: videoCount }
    ];

    return { tiles, bars };
  }

  toggleCustomizePanel() {
    this.showCustomizePanel = !this.showCustomizePanel;
  }

  toggleTile(tileId: string) {
    if (this.visibleTileIds.has(tileId)) {
      if (this.visibleTileIds.size === 1) return;
      this.visibleTileIds.delete(tileId);
    } else {
      this.visibleTileIds.add(tileId);
    }

    this.visibleTileIds = new Set(this.visibleTileIds);
    this.savePreferences();
  }

  toggleDistribution() {
    this.showDistribution = !this.showDistribution;
    this.savePreferences();
  }

  toggleGroupSwitcher() {
    this.showGroupSwitcher = !this.showGroupSwitcher;
    this.savePreferences();
  }

  resetPreferences() {
    this.visibleTileIds = new Set(this.tiles.map((tile) => tile.id));
    this.showDistribution = true;
    this.showGroupSwitcher = true;
    this.savePreferences();
  }

  trackTile(_: number, tile: StatTile) {
    return tile.id;
  }

  distributionWidth(value: number): number {
    return this.totalPosts === 0 ? 0 : (value / this.totalPosts) * 100;
  }

  goToGroup(): void {
    if (!this.groupId) return;

    this.router.navigate(['/groups', this.groupId]);
  }

  private loadPreferences() {
    if (typeof window === 'undefined') return;

    const raw = window.localStorage.getItem(this.preferenceKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as {
        visibleTileIds?: string[];
        showDistribution?: boolean;
        showGroupSwitcher?: boolean;
      };

      this.visibleTileIds = new Set(parsed.visibleTileIds ?? []);
      this.showDistribution = parsed.showDistribution ?? true;
      this.showGroupSwitcher = parsed.showGroupSwitcher ?? true;
    } catch {
      this.visibleTileIds = new Set();
    }
  }

  private ensureVisibleTiles() {
    const availableIds = new Set(this.tiles.map((tile) => tile.id));
    const nextVisible = [...this.visibleTileIds].filter((id) => availableIds.has(id));

    if (nextVisible.length === 0) {
      this.visibleTileIds = new Set(this.tiles.map((tile) => tile.id));
      this.savePreferences();
      return;
    }

    this.visibleTileIds = new Set(nextVisible);
  }

  private savePreferences() {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(this.preferenceKey, JSON.stringify({
      visibleTileIds: [...this.visibleTileIds],
      showDistribution: this.showDistribution,
      showGroupSwitcher: this.showGroupSwitcher
    }));
  }
}
