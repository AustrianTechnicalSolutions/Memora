import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environment';

interface AuthResponse {
  token: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/api/auth`;

  constructor(private http: HttpClient) {}

  login(email: string, password: string, twoFactorCode?: string) {
    const body: any = { email, password };

    if (twoFactorCode?.trim()) {
      body.twoFactorCode = twoFactorCode.trim();
    }

    return this.http
      .post<AuthResponse>(`${this.apiUrl}/login`, body)
      .pipe(
        tap(res => localStorage.setItem('token', res.token))
      );
  }

  register(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/register`, { email, password })
      .pipe(
        tap(res => localStorage.setItem('token', res.token))
      );
  }

  logout() {
    localStorage.removeItem('token');
  }

  get token(): string | null {
    return localStorage.getItem('token');
  }

  isLoggedIn(): boolean {
    return !!this.token;
  }
}
