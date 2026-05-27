import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';

import QRCode from 'qrcode';
import { TwoFactorService, TwoFactorSetupResponse } from './twofactor';
import { ThemeService } from '../../theme.service';
import { TranslatePipe } from '../../translation/translate.pipe';
import { AppLanguage, I18nService } from '../../translation/i18n.service';
import { AuthService } from '../auth.service';
import { environment } from '../../../environment';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './settings.html',
  styleUrls: ['./settings.css']
})
export class SettingsComponent {
  private api = `${environment.apiUrl}/api/account`

  loading = true;
  saving = false;

  msg = '';
  err = '';

  profile: any = {
    displayName: '',
    bio: '',
    status: '',
    birthDate: '',
    profileImageUrl: '',
    phoneNumber: '',
    discordTag: '',
    instagramUrl: '',
    tiktokUrl: '',
    youtubeUrl: '',
    websiteUrl: ''
  };

  password = {
    currentPassword: '',
    newPassword: '',
    twoFactorCode: ''
  };

  // ===== 2FA UI state =====
  twoFaLoading = false;
  twoFaEnabled = false;
  twoFaSecret = '';
  twoFaOtpAuthUrl = '';
  twoFaQrDataUrl = '';
  twoFaCode = '';

  twoFaDisableCode = '';
  twoFaBackupCodes: string[] = [];
  twoFaRegenerateCode = '';

  twoFaError = '';

  constructor(
    private http: HttpClient,
    private twoFactor: TwoFactorService,
    private theme: ThemeService,
    private i18n: I18nService,
    private auth: AuthService
  ) {}

  get themeMode() {
    return this.theme.current;
  }

  get language(): AppLanguage {
    return this.i18n.currentLanguage;
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  setLanguage(language: AppLanguage) {
    this.i18n.setLanguage(language);
  }

  ngOnInit() {
    this.http.get<any>(`${this.api}/me`).subscribe({
      next: (data) => {
        this.profile.displayName = data.displayName ?? '';
        this.profile.bio = data.bio ?? '';
        this.profile.status = data.status ?? '';
        this.profile.birthDate = data.birthDate ? data.birthDate.slice(0, 10) : '';
        this.profile.profileImageUrl = data.profileImageUrl ?? '';
        this.profile.phoneNumber = data.phoneNumber ?? '';
        this.profile.discordTag = data.discordTag ?? '';
        this.profile.instagramUrl = data.instagramUrl ?? '';
        this.profile.tiktokUrl = data.tiktokUrl ?? '';
        this.profile.youtubeUrl = data.youtubeUrl ?? '';
        this.profile.websiteUrl = data.websiteUrl ?? '';

        this.twoFaEnabled = data.twoFactorEnabled ?? false;

        this.loading = false;
      },
      error: (e) => {
        console.error(e);
        this.err = this.i18n.translate('settings.profileLoadFailed');
        this.loading = false;
      }
    });
  }

  clearMessages() {
    this.msg = '';
    this.err = '';
    this.twoFaError = '';
  }

  saveProfile() {
    this.saving = true;
    this.clearMessages();

    const body = {
      displayName: this.profile.displayName,
      bio: this.profile.bio,
      status: this.profile.status,
      birthDate: this.profile.birthDate ? new Date(this.profile.birthDate).toISOString() : null,
      profileImageUrl: this.profile.profileImageUrl,

      phoneNumber: this.profile.phoneNumber,
      discordTag: this.profile.discordTag,

      instagramUrl: this.profile.instagramUrl,
      tiktokUrl: this.profile.tiktokUrl,
      youtubeUrl: this.profile.youtubeUrl,
      websiteUrl: this.profile.websiteUrl
    };

    this.http.put(`${this.api}/profile`, body).subscribe({
      next: () => {
        this.msg = this.i18n.translate('settings.profileSaved');
        this.saving = false;
        this.auth.notifyProfileChanged();
      },
      error: (e) => {
        console.error(e);
        this.err = this.i18n.translate('settings.profileSaveFailed');
        this.saving = false;
      }
    });
  }

  changePassword() {
    this.saving = true;
    this.clearMessages();

    const body: any = {
      currentPassword: this.password.currentPassword,
      newPassword: this.password.newPassword,
    };
    if (this.twoFaEnabled && this.password.twoFactorCode) {
      body.twoFactorCode = this.password.twoFactorCode;
    }

    this.http.put(`${this.api}/password`, body).subscribe({
      next: () => {
        this.msg = this.i18n.translate('settings.passwordChanged');
        this.password.currentPassword = '';
        this.password.newPassword = '';
        this.password.twoFactorCode = '';
        this.saving = false;
      },
      error: (e) => {
        console.error(e);
        this.err = e?.error ?? this.i18n.translate('settings.passwordChangeFailed');
        this.saving = false;
      }
    });
  }

  // ===== 2FA actions =====

  async setup2FA() {
    this.twoFaLoading = true;
    this.clearMessages();

    this.twoFaSecret = '';
    this.twoFaOtpAuthUrl = '';
    this.twoFaQrDataUrl = '';
    this.twoFaCode = '';

    this.twoFactor.setup().subscribe({
      next: async (res: TwoFactorSetupResponse) => {
        this.twoFaSecret = res.secret;
        this.twoFaOtpAuthUrl = res.otpauthUrl;

        // Generate QR image
        this.twoFaQrDataUrl = await QRCode.toDataURL(res.otpauthUrl);

        this.twoFaLoading = false;
        this.msg = this.i18n.translate('settings.twoFactorSetupHint');
      },
      error: (e) => {
        console.error(e);
        this.err = this.i18n.translate('settings.twoFactorSetupFailed');
        this.twoFaLoading = false;
      }
    });
  }

  enable2FA() {
    const code = this.twoFaCode.trim();
    if (!code) return;

    this.twoFaLoading = true;
    this.clearMessages();

    this.twoFactor.enable(code).subscribe({
      next: (res) => {
        this.twoFaEnabled = true;
        this.twoFaBackupCodes = res.backupCodes ?? [];

        this.twoFaSecret = '';
        this.twoFaOtpAuthUrl = '';
        this.twoFaQrDataUrl = '';
        this.twoFaCode = '';

        this.twoFaLoading = false;
        this.msg = this.i18n.translate('settings.twoFactorEnabled');
      },
      error: (e) => {
        console.error(e);
        this.setTwoFaError(e, 'settings.twoFactorInvalid');
        this.twoFaLoading = false;
      }
    });
  }

  disable2FA() {
    const code = this.twoFaDisableCode.trim();
    if (!code) return;

    this.twoFaLoading = true;
    this.clearMessages();

    this.twoFactor.disable(code).subscribe({
      next: () => {
        this.twoFaEnabled = false;

        this.twoFaSecret = '';
        this.twoFaOtpAuthUrl = '';
        this.twoFaQrDataUrl = '';
        this.twoFaCode = '';
        this.twoFaDisableCode = '';
        this.twoFaBackupCodes = [];

        this.twoFaLoading = false;
        this.msg = this.i18n.translate('settings.twoFactorDisabled');
      },
      error: (e) => {
        console.error(e);
        this.setTwoFaError(e, 'settings.twoFactorInvalid');
        this.twoFaLoading = false;
      }
    });
  }

  regenerateBackupCodes() {
    const code = this.twoFaRegenerateCode.trim();
    if (!code) return;

    this.twoFaLoading = true;
    this.clearMessages();

    this.twoFactor.regenerateBackupCodes(code).subscribe({
      next: (res) => {
        this.twoFaBackupCodes = res.backupCodes ?? [];
        this.twoFaRegenerateCode = '';
        this.twoFaLoading = false;
        this.msg = this.i18n.translate('settings.twoFactorBackupCodesGenerated');
      },
      error: (e) => {
        console.error(e);
        this.setTwoFaError(e, 'settings.twoFactorInvalid');
        this.twoFaLoading = false;
      }
    });
  }

  downloadBackupCodes() {
    if (!this.twoFaBackupCodes.length) return;

    const content = [
      'Memory backup codes',
      '',
      'Store these somewhere safe. Each code can only be used once.',
      '',
      ...this.twoFaBackupCodes
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'memora-backup-codes.txt';
    a.click();

    URL.revokeObjectURL(url);

    this.twoFaBackupCodes = [];
  }

  // Profile image
  onProfileImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    if (!file.type.startsWith('image/')) {
      this.err = this.i18n.translate('settings.selectImage');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.profile.profileImageUrl = reader.result as string;
    };

    reader.readAsDataURL(file);
  }

  removeProfileImage() {
    this.profile.profileImageUrl = '';
  }

  private setTwoFaError(e: any, fallbackKey: string) {
    this.twoFaError =
      e?.error?.message ??
      e?.error ??
      this.i18n.translate(fallbackKey);
  }
}
