import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { AuthUser, LoginCredentials, LoginResponse, RegisterCredentials } from './auth.models';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
const STORAGE_KEY = 'taskflow.accessToken';

export class SessionStorageError extends Error {}

function profileFromResponse(value: unknown): AuthUser {
  if (typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' || !value.id ||
    !('name' in value) || typeof value.name !== 'string' || !value.name ||
    !('email' in value) || typeof value.email !== 'string' || !value.email ||
    !('createdAt' in value) || typeof value.createdAt !== 'string' || !value.createdAt) {
    throw new Error('Resposta de perfil inválida.');
  }
  return { id: value.id, name: value.name, email: value.email, createdAt: value.createdAt };
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (typeof value !== 'object' || value === null ||
    !('accessToken' in value) || typeof value.accessToken !== 'string' || !value.accessToken ||
    !('tokenType' in value) || value.tokenType !== 'Bearer' ||
    !('expiresIn' in value) || typeof value.expiresIn !== 'number' || value.expiresIn <= 0 ||
    !('user' in value) || typeof value.user !== 'object' || value.user === null) {
    return false;
  }
  const user = value.user;
  return 'id' in user && typeof user.id === 'string' && user.id.length > 0 &&
    'name' in user && typeof user.name === 'string' && user.name.length > 0 &&
    'email' in user && typeof user.email === 'string' && user.email.length > 0;
}

function tokenFromResponse(value: unknown): string {
  if (!isLoginResponse(value)) {
    throw new Error('Resposta de autenticação inválida.');
  }
  return value.accessToken;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly document = inject(DOCUMENT);
  private readonly statusState = signal<SessionStatus>('loading');
  private readonly userState = signal<AuthUser | null>(null);
  private readonly expiredState = signal(false);
  private token: string | null = null;
  private generation = 0;
  private restoreRequest: Observable<SessionStatus> | null = null;
  private mustClearStorage = false;

  readonly status = this.statusState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly sessionExpired = this.expiredState.asReadonly();

  getToken(): string | null {
    return this.token;
  }

  getSessionVersion(): number {
    return this.generation;
  }

  register(credentials: RegisterCredentials): Observable<AuthUser> {
    this.expiredState.set(false);
    return this.http.post<AuthUser>(`${this.baseUrl}/auth/register`, credentials);
  }

  login(credentials: LoginCredentials): Observable<AuthUser> {
    const generation = ++this.generation;
    this.expiredState.set(false);
    return this.http.post<unknown>(`${this.baseUrl}/auth/login`, credentials).pipe(
      switchMap((response) => {
        if (generation !== this.generation) {
          return throwError(() => new Error('A operação de autenticação foi cancelada.'));
        }
        const token = tokenFromResponse(response);
        try {
          this.storage().setItem(STORAGE_KEY, token);
        } catch {
          return throwError(() => new SessionStorageError('Não foi possível armazenar a sessão neste navegador.'));
        }
        this.token = token;
        return this.http.get<unknown>(`${this.baseUrl}/auth/me`).pipe(map(profileFromResponse));
      }),
      tap((user) => {
        if (generation !== this.generation) {
          throw new Error('A operação de autenticação foi cancelada.');
        }
        this.userState.set(user);
        this.statusState.set('authenticated');
      }),
      catchError((error: unknown) => {
        if (generation === this.generation && this.token) {
          this.clearSession(false);
        }
        return throwError(() => error);
      }),
      finalize(() => {
        if (generation === this.generation && this.token && this.statusState() !== 'authenticated') {
          this.clearSession(false);
        }
      }),
    );
  }

  restoreSession(): Observable<SessionStatus> {
    if (this.statusState() === 'authenticated' || this.statusState() === 'unauthenticated') {
      return of(this.statusState());
    }
    if (this.restoreRequest) {
      return this.restoreRequest;
    }
    try {
      if (this.mustClearStorage) {
        this.storage().removeItem(STORAGE_KEY);
        this.mustClearStorage = false;
        this.statusState.set('unauthenticated');
        return of('unauthenticated');
      }
      this.token = this.storage().getItem(STORAGE_KEY);
    } catch {
      this.statusState.set('error');
      return of('error');
    }
    if (!this.token) {
      this.statusState.set('unauthenticated');
      return of('unauthenticated');
    }
    this.statusState.set('loading');
    const generation = this.generation;
    const request = this.http.get<unknown>(`${this.baseUrl}/auth/me`).pipe(
      map((response): SessionStatus => {
        if (generation !== this.generation) return this.statusState();
        const user = profileFromResponse(response);
        this.userState.set(user);
        this.statusState.set('authenticated');
        return 'authenticated';
      }),
      catchError((error: unknown) => {
        if (generation !== this.generation) return of(this.statusState());
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.clearSession(true);
          return of<SessionStatus>('unauthenticated');
        }
        this.statusState.set('error');
        return of<SessionStatus>('error');
      }),
      finalize(() => {
        if (this.restoreRequest === request) this.restoreRequest = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.restoreRequest = request;
    return request;
  }

  logout(): void {
    this.clearSession(false);
  }

  expireSession(token: string, generation: number): boolean {
    if (this.token !== token || this.generation !== generation) return false;
    const wasAuthenticated = this.statusState() === 'authenticated';
    this.clearSession(true);
    return wasAuthenticated;
  }

  private clearSession(expired: boolean): void {
    this.generation++;
    this.restoreRequest = null;
    this.token = null;
    this.userState.set(null);
    this.expiredState.set(expired);
    try {
      this.storage().removeItem(STORAGE_KEY);
      this.mustClearStorage = false;
      this.statusState.set('unauthenticated');
    } catch {
      this.mustClearStorage = true;
      this.statusState.set('error');
    }
  }

  private storage(): Storage {
    const storage = this.document.defaultView?.sessionStorage;
    if (!storage) throw new Error('Armazenamento de sessão indisponível.');
    return storage;
  }
}
