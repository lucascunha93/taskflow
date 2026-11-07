import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription, catchError, filter, fromEvent, map, merge, of, switchMap, tap, timer } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { AuthService } from '../../core/auth/auth.service';
import { AppNotification, NotificationPage, notificationPageFromResponse } from './notification.models';

/** Intervalo de atualização enquanto a aba está visível. Não há envio em tempo real pela API. */
export const NOTIFICATION_POLL_MS = 60_000;

/**
 * Notificações do usuário autenticado. A lista é consultada ao iniciar, a
 * cada minuto com a aba visível e ao voltar para a aba; é limpa quando a
 * sessão termina.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly itemsState = signal<AppNotification[]>([]);
  private readonly unreadState = signal(0);
  private readonly statusState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  private polling: Subscription | null = null;
  private generation = 0;

  readonly items = this.itemsState.asReadonly();
  readonly unreadCount = this.unreadState.asReadonly();
  readonly status = this.statusState.asReadonly();

  constructor() {
    this.auth.sessionEnded.subscribe(() => this.stop());
  }

  /** Inicia as consultas periódicas; chamadas repetidas não criam outro ciclo. */
  start(): void {
    if (this.polling) return;
    const visible = () => this.document.visibilityState !== 'hidden';
    this.polling = merge(
      timer(0, NOTIFICATION_POLL_MS).pipe(filter(visible)),
      fromEvent(this.document, 'visibilitychange').pipe(filter(visible)),
    ).pipe(switchMap(() => this.fetch().pipe(catchError(() => {
      this.statusState.set(this.itemsState().length ? 'ready' : 'error');
      return of(null);
    })))).subscribe();
  }

  stop(): void {
    this.generation++;
    this.polling?.unsubscribe();
    this.polling = null;
    this.itemsState.set([]);
    this.unreadState.set(0);
    this.statusState.set('idle');
  }

  refresh(): void {
    this.fetch().subscribe({ error: () => this.statusState.set('error') });
  }

  /** Marca como lida localmente e na API; uma falha restaura o estado anterior. */
  markRead(notification: AppNotification): void {
    if (notification.readAt) return;
    const previous = { items: this.itemsState(), unread: this.unreadState() };
    this.itemsState.update((items) => items.map((item) => item.id === notification.id
      ? { ...item, readAt: new Date().toISOString() } : item));
    this.unreadState.update((count) => Math.max(0, count - 1));
    const generation = this.generation;
    this.http.post<void>(`${this.base}/notifications/${encodeURIComponent(notification.id)}/read`, null).subscribe({
      error: () => {
        if (generation !== this.generation) return;
        this.itemsState.set(previous.items);
        this.unreadState.set(previous.unread);
      },
    });
  }

  markAllRead(): Observable<void> {
    const generation = this.generation;
    return this.http.post<void>(`${this.base}/notifications/read-all`, null).pipe(
      tap(() => {
        if (generation !== this.generation) return;
        const now = new Date().toISOString();
        this.itemsState.update((items) => items.map((item) => item.readAt ? item : { ...item, readAt: now }));
        this.unreadState.set(0);
      }),
    );
  }

  private fetch(): Observable<NotificationPage | null> {
    if (this.auth.status() !== 'authenticated') return of(null);
    const generation = this.generation;
    if (this.statusState() === 'idle') this.statusState.set('loading');
    return this.http.get<unknown>(`${this.base}/notifications`, { params: new HttpParams().set('limit', 20) }).pipe(
      map(notificationPageFromResponse),
      tap((page) => {
        if (generation !== this.generation) return;
        this.itemsState.set(page.data);
        this.unreadState.set(page.unreadCount);
        this.statusState.set('ready');
      }),
    );
  }
}
