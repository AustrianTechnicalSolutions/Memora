import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService, CurrentUser } from '../user/auth.service';
import { Router } from '@angular/router';
import { GroupsService, GroupListItemDto } from '../groups/groups';
import { Subscription } from 'rxjs';
import { ThemeService } from '../theme.service';
import { TranslatePipe } from '../translation/translate.pipe';
import { I18nService } from '../translation/i18n.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslatePipe],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css'
})
export class SidebarComponent implements OnInit, OnDestroy {
  userProfileImageUrl: string | null = null;
  currentUser: CurrentUser | null = null;
  groups: GroupListItemDto[] = [];
  sidebarOpen = false;

  private subscriptions: Subscription = new Subscription();

  constructor(
    private auth: AuthService,
    public router: Router,
    private groupsService: GroupsService,
    private theme: ThemeService,
    private i18n: I18nService
  ) {}

  get themeMode() {
    return this.theme.current;
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  ngOnInit() {
    this.loadUserProfile();
    this.loadGroups();
    
    this.subscriptions.add(
      this.groupsService.groupsChanged$.subscribe(() => {
        this.loadGroups();
      })
    );

    this.subscriptions.add(
      this.auth.profileChanged$.subscribe(() => {
        this.loadUserProfile();
      })
    );
  }

  loadUserProfile() {
    this.auth.currentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
        this.userProfileImageUrl = user.profileImageUrl || null;
      },
      error: (err) => {
        console.error('Failed to load user profile:', err);
      }
    });
  }

  loadGroups() {
    this.groupsService.myGroups().subscribe({
      next: (groups) => {
        this.groups = groups.slice(0, 5);
      },
      error: (err) => {
        console.error('Failed to load groups:', err);
      }
    });
  }

  logout() {
    if (this.auth.confirmLogout()) {
      this.auth.logout();
      this.router.navigate(['/login']);
    }
  }

  t(key: string, params?: Record<string, string | number>) {
    return this.i18n.translate(key, params);
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  isGroupActive(groupId: string): boolean {
    return this.router.url.startsWith(`/groups/${groupId}`);
  }
}
