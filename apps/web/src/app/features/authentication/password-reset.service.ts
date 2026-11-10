import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';

/** Recuperação de senha (endpoints públicos). */
@Injectable({ providedIn: 'root' })
export class PasswordResetService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');

  forgot(email: string): Observable<unknown> {
    return this.http.post(`${this.base}/auth/password/forgot`, { email });
  }

  reset(token: string, newPassword: string): Observable<unknown> {
    return this.http.post(`${this.base}/auth/password/reset`, { token, newPassword });
  }
}
