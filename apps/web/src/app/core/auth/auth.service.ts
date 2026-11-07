import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import {
  Observable, Subject, catchError, finalize, map, of, retry, shareReplay, switchMap, tap, throwError, timer,
} from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { AuthUser, LoginCredentials, LoginResponse, RegisterCredentials } from './auth.models';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
/** Chave usada por versões anteriores, que guardavam o access token no navegador. */
const LEGACY_STORAGE_KEY = 'taskflow.accessToken';
/** Exigido pela API nos endpoints que usam o cookie de refresh (proteção contra CSRF). */
const SESSION_HEADERS = new HttpHeaders({ 'X-TaskFlow-Request': '1' });
/** Espera antes de repetir um refresh recusado por concorrência (409) com outra aba. */
const CONCURRENT_REFRESH_RETRY_MS = 400;

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

function tokenFromResponse(value: unknown): LoginResponse {
  if (!isLoginResponse(value)) {
    throw new Error('Resposta de autenticação inválida.');
  }
  return value;
}

/**
 * Sessão do usuário. O access token fica somente em memória; o refresh token
 * é um cookie HttpOnly gerenciado pela API e inacessível a scripts. Ao
 * recarregar a página, a sessão é restaurada por `POST /auth/refresh`.
 */
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
  private refreshRequest: Observable<string> | null = null;
  private readonly sessionEndedSubject = new Subject<void>();

  readonly status = this.statusState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly sessionExpired = this.expiredState.asReadonly();
  readonly sessionEnded = this.sessionEndedSubject.asObservable();

  constructor() {
    this.removeLegacyToken();
  }

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
    this.refreshRequest = null;
    this.expiredState.set(false);
    return this.http.post<unknown>(`${this.baseUrl}/auth/login`, credentials, { withCredentials: true }).pipe(
      switchMap((response) => {
        if (generation !== this.generation) {
          return throwError(() => new Error('A operação de autenticação foi cancelada.'));
        }
        this.token = tokenFromResponse(response).accessToken;
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

  /** Restaura a sessão a partir do cookie de refresh, sem credenciais salvas no navegador. */
  restoreSession(): Observable<SessionStatus> {
    if (this.statusState() === 'authenticated' || this.statusState() === 'unauthenticated') {
      return of(this.statusState());
    }
    if (this.restoreRequest) {
      return this.restoreRequest;
    }
    this.statusState.set('loading');
    const generation = this.generation;
    const request = this.refresh().pipe(
      switchMap(() => this.http.get<unknown>(`${this.baseUrl}/auth/me`)),
      map((response): SessionStatus => {
        if (generation !== this.generation) return this.statusState();
        this.userState.set(profileFromResponse(response));
        this.statusState.set('authenticated');
        return 'authenticated';
      }),
      catchError((error: unknown) => {
        if (generation !== this.generation) return of(this.statusState());
        if (error instanceof HttpErrorResponse && error.status === 401) {
          // Sem cookie ou com sessão encerrada: simplesmente não há sessão para restaurar.
          this.token = null;
          this.statusState.set('unauthenticated');
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

  /**
   * Obtém um novo access token pelo cookie de refresh. Chamadas simultâneas
   * compartilham a mesma requisição; um 409 (outra aba renovando o mesmo
   * cookie) é repetido uma vez.
   */
  refresh(): Observable<string> {
    if (this.refreshRequest) return this.refreshRequest;
    const generation = this.generation;
    const request = this.http.post<unknown>(`${this.baseUrl}/auth/refresh`, null, {
      headers: SESSION_HEADERS, withCredentials: true,
    }).pipe(
      retry({
        count: 1,
        delay: (error: unknown) => error instanceof HttpErrorResponse && error.status === 409
          ? timer(CONCURRENT_REFRESH_RETRY_MS)
          : throwError(() => error),
      }),
      map((response) => {
        const session = tokenFromResponse(response);
        if (generation !== this.generation) {
          throw new Error('A sessão mudou durante a renovação.');
        }
        const currentUser = this.userState();
        if (currentUser && currentUser.id !== session.user.id) {
          throw new Error('A renovação retornou outro usuário.');
        }
        this.token = session.accessToken;
        return session.accessToken;
      }),
      finalize(() => {
        if (this.refreshRequest === request) this.refreshRequest = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.refreshRequest = request;
    return request;
  }

  /** Atualiza o nome do usuário autenticado e reflete o perfil retornado pela API. */
  updateProfile(name: string): Observable<AuthUser> {
    const generation = this.generation;
    const userId = this.userState()?.id;
    if (!userId || this.statusState() !== 'authenticated') {
      return throwError(() => new Error('Não há uma sessão válida para atualizar o perfil.'));
    }
    return this.http.patch<unknown>(`${this.baseUrl}/auth/me`, { name }).pipe(
      map(profileFromResponse),
      tap((user) => {
        if (generation !== this.generation || user.id !== userId) {
          throw new Error('A sessão mudou durante a atualização do perfil.');
        }
        this.userState.set(user);
      }),
    );
  }

  /**
   * Troca a senha. A API revoga todos os tokens anteriores, grava um novo
   * cookie de refresh e devolve um novo access token para esta sessão.
   */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    const generation = this.generation;
    const userId = this.userState()?.id;
    if (!userId || this.statusState() !== 'authenticated') {
      return throwError(() => new Error('Não há uma sessão válida para trocar a senha.'));
    }
    return this.http.put<unknown>(`${this.baseUrl}/auth/me/password`, { currentPassword, newPassword }, {
      withCredentials: true,
    }).pipe(
      map((response) => {
        if (generation !== this.generation || this.userState()?.id !== userId ||
          !isLoginResponse(response) || response.user.id !== userId) {
          throw new Error('A sessão mudou durante a troca de senha.');
        }
        this.token = response.accessToken;
      }),
    );
  }

  /** Encerra todas as sessões do usuário na API, inclusive esta, e limpa a sessão local. */
  revokeAllSessions(): Observable<void> {
    const generation = this.generation;
    if (this.statusState() !== 'authenticated') {
      return throwError(() => new Error('Não há uma sessão válida para encerrar.'));
    }
    return this.http.delete<void>(`${this.baseUrl}/auth/me/sessions`, { withCredentials: true }).pipe(
      map(() => {
        if (generation === this.generation) this.clearSession(false);
      }),
    );
  }

  /**
   * Sai desta sessão: limpa o estado local imediatamente e pede à API que
   * revogue o refresh token do cookie. Uma falha de rede não impede a saída
   * local; nesse caso o cookie expira no prazo configurado na API.
   */
  logout(): void {
    this.clearSession(false);
    this.http.post(`${this.baseUrl}/auth/logout`, null, { headers: SESSION_HEADERS, withCredentials: true })
      .subscribe({ error: () => undefined });
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
    this.refreshRequest = null;
    this.token = null;
    this.userState.set(null);
    this.expiredState.set(expired);
    this.statusState.set('unauthenticated');
    this.sessionEndedSubject.next();
  }

  private removeLegacyToken(): void {
    try {
      this.document.defaultView?.sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Armazenamento indisponível: não há token legado acessível para remover.
    }
  }
}
