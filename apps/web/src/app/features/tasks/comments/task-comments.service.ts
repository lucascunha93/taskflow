import { HttpClient, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { Observable, Subject, defer, map, takeUntil, throwError } from 'rxjs';
import { API_BASE_URL } from '../../../core/api-base-url';
import { OrganizationsService } from '../../organizations/organizations.service';
import { TaskComment, TaskCommentPage, commentFromResponse } from './task-comment.models';

/** Comentários da tarefa na organização ativa; requisições são canceladas ao trocar de organização. */
@Injectable()
export class TaskCommentsService {
  private readonly http = inject(HttpClient);
  private readonly organizations = inject(OrganizationsService);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private readonly contextChanged = new Subject<void>();

  constructor() {
    effect(() => {
      this.activeId();
      this.contextChanged.next();
    });
    inject(DestroyRef).onDestroy(() => {
      this.contextChanged.next();
      this.contextChanged.complete();
    });
  }

  list(taskId: string, after: string | null = null, limit = 50): Observable<TaskCommentPage> {
    let params = new HttpParams().set('limit', limit);
    if (after) params = params.set('after', after);
    return this.request(taskId, (url) => this.http.get<unknown>(url, { params }), (result) => {
      if (typeof result !== 'object' || result === null || !('data' in result) || !Array.isArray(result.data) ||
        !('nextCursor' in result) || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
        throw new Error('Resposta de comentários inválida.');
      }
      return { data: result.data.map((item: unknown) => commentFromResponse(item, taskId)), nextCursor: result.nextCursor };
    });
  }

  create(taskId: string, body: string): Observable<TaskComment> {
    return this.request(taskId, (url) => this.http.post<unknown>(url, { body }), (result) => commentFromResponse(result, taskId));
  }

  update(taskId: string, commentId: string, body: string): Observable<TaskComment> {
    return this.request(taskId, (url) => this.http.patch<unknown>(`${url}/${encodeURIComponent(commentId)}`, { body }),
      (result) => commentFromResponse(result, taskId));
  }

  remove(taskId: string, commentId: string): Observable<void> {
    return this.request(taskId, (url) => this.http.delete<void>(`${url}/${encodeURIComponent(commentId)}`), () => undefined);
  }

  private request<T, R>(taskId: string, send: (url: string) => Observable<T>, check: (result: T) => R): Observable<R> {
    return defer(() => {
      const organizationId = this.activeId();
      if (!organizationId) return throwError(() => new Error('Selecione uma organização.'));
      const url = `${this.base}/organizations/${encodeURIComponent(organizationId)}/tasks/${encodeURIComponent(taskId)}/comments`;
      return send(url).pipe(
        takeUntil(this.contextChanged),
        map((result) => {
          if (this.activeId() !== organizationId) throw new Error('A organização ativa mudou.');
          return check(result);
        }),
      );
    });
  }
}
