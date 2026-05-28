import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../user/auth.service';
import { GroupsService, MemoryDto } from '../../groups/groups';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { TranslatePipe } from '../../translation/translate.pipe';

@Component({
  standalone: true,
  selector: 'app-overview-sidebar',
  imports: [CommonModule, TranslatePipe],
  templateUrl: './overview-sidebar.html',
  styleUrls: ['./overview-sidebar.css']
})
export class OverviewSidebarComponent implements OnInit {
  totalGroups = 0;
  totalMemories = 0;
  totalLikes = 0;

  constructor(private auth: AuthService, private groupsService: GroupsService) {}

  ngOnInit() {
    this.loadOverview();
  }

  private loadOverview() {
    this.auth.currentUser().pipe(
      switchMap((me) =>
        this.groupsService.myGroups().pipe(
          switchMap((groups) => {
            this.totalGroups = groups.length;
            if (groups.length === 0) {
              return of({ userId: me.id, memories: [] as MemoryDto[] });
            }

            return forkJoin(groups.map((g) => this.collectGroupMemories(g.id))).pipe(
              map((memoryBatches) => ({ userId: me.id, memories: memoryBatches.flat() }))
            );
          })
        )
      ),
      catchError((err) => {
        console.error(err);
        return of({ userId: '', memories: [] as MemoryDto[] });
      })
    ).subscribe(({ userId, memories }) => {
      if (!userId) {
        return;
      }

      const own = memories.filter((m) => m.createdByUserId === userId);
      this.totalMemories = own.length;
      this.totalLikes = memories.reduce((sum, m) => sum + (m.likeCount ?? 0), 0);
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
      switchMap((first) => {
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
}
