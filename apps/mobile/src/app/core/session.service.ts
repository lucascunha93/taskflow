import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './api-base-url';
import { SecureStore } from './secure-store';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

interface MobileSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: SessionUser;
}

/**
 * - `starting`: lendo a sessão guardada.
 * - `online`: autenticado, com access token válido.
 * - `offline`: há sessão guardada, mas a renovação falhou por falta de rede;
 *   o app funciona com os dados do aparelho e renova ao reconectar.
 * - `signed-out`: sem sessão (nunca entrou, saiu ou a sessão expirou).
 */
export type SessionStatus = 'starting' | 'online' | 'offline' | 'signed-out';

/** Chamado antes de trocar de usuário, para apagar os dados locais do anterior. */
export const SESSION_USER_CHANGED = new InjectionToken<(previousUserId: string | null) => Promise<void>>('SESSION_USER_CHANGED');

const REFRESH_KEY = 'taskflow.refreshToken';
const USER_KEY = 'taskflow.user';
/** Renova o access token um pouco antes de expirar. */
const EXPIRY_MARGIN_MS = 30_000;

/** Falha da sessão por falta de rede (não por credencial inválida). */
export class SessionOfflineError extends Error {}

/**
 * Sessão do app. O refresh token fica no armazenamento seguro do sistema e o
 * access token somente em memória. Renovações simultâneas compartilham a
 * mesma requisição, porque a API rotaciona o refresh token a cada uso.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  // HttpBackend ignora os interceptors: as rotas de sessão não usam access token.
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly store = inject(SecureStore);
  private readonly userChanged = inject(SESSION_USER_CHANGED, { optional: true });
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;

  private readonly statusState = signal<SessionStatus>('starting');
  private readonly userState = signal<SessionUser | null>(null);
  readonly status = this.statusState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly signedIn = computed(() => this.statusState() === 'online' || this.statusState() === 'offline');

  /** Restaura a sessão guardada, se houver. */
  async start(): Promise<void> {
    const [token, user] = await Promise.all([this.store.get(REFRESH_KEY), this.store.get(USER_KEY)]);
    if (!token || !user) {
      this.statusState.set('signed-out');
      return;
    }
    this.userState.set(JSON.parse(user) as SessionUser);
    try {
      await this.refresh();
    } catch {
      // `refresh` já define o estado (offline ou signed-out).
    }
  }

  async login(email: string, password: string): Promise<void> {
    const session = await firstValueFrom(this.http.post<MobileSession>(`${this.base}/auth/mobile/login`, { email, password }));
    const previous = await this.store.get(USER_KEY);
    const previousId = previous ? (JSON.parse(previous) as SessionUser).id : null;
    if (previousId !== session.user.id) await this.userChanged?.(previousId);
    await this.save(session);
  }

  /** Encerra a sessão no servidor (se possível) e apaga os dados locais. */
  async logout(): Promise<void> {
    const token = await this.store.get(REFRESH_KEY);
    if (token) {
      try {
        await firstValueFrom(this.http.post(`${this.base}/auth/mobile/logout`, { refreshToken: token }));
      } catch {
        // Sem rede: o token expira sozinho; os dados locais são apagados mesmo assim.
      }
    }
    await this.userChanged?.(this.userState()?.id ?? null);
    await Promise.all([this.store.remove(REFRESH_KEY), this.store.remove(USER_KEY)]);
    this.clear('signed-out');
    this.userState.set(null);
  }

  /** Access token válido, renovando-o se necessário. */
  async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) return this.accessToken;
    return this.refresh();
  }

  /** Renova a sessão. Lança `SessionOfflineError` sem rede e outro erro quando a sessão acabou. */
  refresh(): Promise<string> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const token = await this.store.get(REFRESH_KEY);
    if (!token) {
      this.clear('signed-out');
      throw new Error('Sessão encerrada.');
    }
    try {
      const session = await firstValueFrom(this.http.post<MobileSession>(`${this.base}/auth/mobile/refresh`, { refreshToken: token }));
      await this.save(session);
      return session.accessToken;
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 400)) {
        // Sessão expirada ou revogada: é preciso entrar de novo. Os dados locais
        // e a fila são mantidos para o mesmo usuário continuar após o login.
        await this.store.remove(REFRESH_KEY);
        this.clear('signed-out');
        throw new Error('Sessão expirada.', { cause: error });
      }
      this.clear('offline');
      throw new SessionOfflineError('Sem conexão com o servidor.', { cause: error });
    }
  }

  private async save(session: MobileSession): Promise<void> {
    await Promise.all([
      this.store.set(REFRESH_KEY, session.refreshToken),
      this.store.set(USER_KEY, JSON.stringify(session.user)),
    ]);
    this.accessToken = session.accessToken;
    this.expiresAt = Date.now() + session.expiresIn * 1000;
    this.userState.set(session.user);
    this.statusState.set('online');
  }

  private clear(status: SessionStatus): void {
    this.accessToken = null;
    this.expiresAt = 0;
    this.statusState.set(status);
  }
}
