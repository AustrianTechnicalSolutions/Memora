import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { GroupsService, GroupListItemDto } from '../groups';
import { TranslatePipe } from '../../translation/translate.pipe';
import { I18nService } from '../../translation/i18n.service';

const REFRESH_INTERVAL_MS = 30_000;

@Component({
  selector: 'app-groups-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslatePipe],
  templateUrl: './groups-page.html',
  styleUrls: ['./groups-page.css']
})
export class GroupsPageComponent implements OnDestroy {
  groups: GroupListItemDto[] = [];
  loading = true;

  searchQuery = '';

  newGroupName = '';
  creating = false;
  errorMsg = '';

  inviteCode = '';
  joining = false;
  joinErrorMsg = '';
  joinSuccessMsg = '';

  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private groupsService: GroupsService,
    private i18n: I18nService
  ) {}

  ngOnInit() {
    this.loadGroups();
    this.refreshTimer = setInterval(() => this.loadGroups(), REFRESH_INTERVAL_MS);
  }

  ngOnDestroy() {
    clearInterval(this.refreshTimer);
  }

  get filteredGroups(): GroupListItemDto[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.groups;
    return this.groups.filter(g => g.name.toLowerCase().includes(q));
  }

  loadGroups() {
    this.loading = true;
    this.groupsService.myGroups().subscribe({
      next: (data) => {
        this.groups = data;
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.loading = false;
      }
    });
  }

  createGroup() {
    const name = this.newGroupName.trim();
    if (!name) return;

    this.creating = true;
    this.errorMsg = '';

    this.groupsService.createGroup(name).subscribe({
      next: () => {
        this.newGroupName = '';
        this.creating = false;
        this.loadGroups();
      },
      error: (err) => {
        console.error(err);
        this.creating = false;
        this.errorMsg = err?.error ?? this.i18n.translate('groups.createFailed');
      }
    });
  }

  joinGroup() {
    const code = this.inviteCode.trim();
    if (!code) return;

    this.joining = true;
    this.joinErrorMsg = '';
    this.joinSuccessMsg = '';

    this.groupsService.joinGroup(code).subscribe({
      next: () => {
        this.inviteCode = '';
        this.joining = false;
        this.joinSuccessMsg = 'Erfolgreich beigetreten!';
        this.loadGroups();
      },
      error: (err) => {
        console.error(err);
        this.joining = false;
        this.joinErrorMsg = err?.error ?? this.i18n.translate('groups.joinFailed');
      }
    });
  }
}
