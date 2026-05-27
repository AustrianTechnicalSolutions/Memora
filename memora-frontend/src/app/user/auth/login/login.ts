import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../auth.service';
import { TranslatePipe } from '../../../translation/translate.pipe';
import { I18nService } from '../../../translation/i18n.service';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, FormsModule, RouterModule, TranslatePipe],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent {
  email = '';
  password = '';
  errorMsg = '';

  twoFactorCode = '';
  show2fa = false;

  loading = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private i18n: I18nService
  ) {}

  login() {
    this.errorMsg = '';

    if (!this.email || !this.password) {
      this.errorMsg = this.i18n.translate('common.badRequest');
      return;
    }

    if (this.show2fa && !this.twoFactorCode.trim()) {
      this.errorMsg = this.i18n.translate('auth.login.twoFactorInvalid');
      return;
    }

    this.loading = true;

    this.auth.login(
      this.email,
      this.password,
      this.show2fa ? this.twoFactorCode.trim() : undefined
    ).subscribe({
      next: () => {
        this.loading = false;

        const returnUrl =
          this.route.snapshot.queryParamMap.get('returnUrl') || '/home';

        this.router.navigateByUrl(returnUrl);
      },
      error: (e) => {
        this.loading = false;

        const status = e?.status;
        const code = e?.error?.code ?? '';
        const message = e?.error?.message ?? '';

        // 2FA required
        if (code === '2fa_required') {
          this.show2fa = true;
          this.twoFactorCode = '';
          this.errorMsg = '';
          return;
        }

        // Invalid 2FA / backup code
        if (code === '2fa_invalid') {
          this.errorMsg = this.i18n.translate('auth.login.twoFactorInvalid');
          return;
        }

        // Invalid login credentials
        if (code === 'unauthorized') {
          this.errorMsg = this.i18n.translate('auth.login.failed');
          return;
        }

        if (status === 400) {
          this.errorMsg = this.i18n.translate('common.badRequest');
          return;
        }

        if (status === 429) {
          this.errorMsg = this.i18n.translate('auth.login.ratelimited');
          return;
        }

        console.error('LOGIN ERROR:', code, message);

        this.errorMsg = this.i18n.translate('common.error');
      }
    });
  }

  backToLogin() {
    this.show2fa = false;
    this.twoFactorCode = '';
    this.errorMsg = '';
  }
}