import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { Observable, Subject, defer, filter, map, takeUntil, throwError } from 'rxjs';
import { API_BASE_URL } from '../../../core/api-base-url';
import { OrganizationsService } from '../../organizations/organizations.service';
import { TaskAttachment, attachmentFromResponse } from './attachment.models';

export type UploadProgress = { kind: 'progress'; percent: number } | { kind: 'done'; attachment: TaskAttachment };

/** Anexos da tarefa na organização ativa; requisições são canceladas ao trocar de organização. */
@Injectable()
export class TaskAttachmentsService {
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

  list(taskId: string): Observable<TaskAttachment[]> {
    return this.request(taskId, (url) => this.http.get<unknown>(url)).pipe(map((value) => {
      if (!Array.isArray(value)) throw new Error('Resposta de anexos inválida.');
      return value.map((item: unknown) => attachmentFromResponse(item, taskId));
    }));
  }

  upload(taskId: string, file: File): Observable<UploadProgress> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.request(taskId, (url) => this.http.post<unknown>(url, body, { reportProgress: true, observe: 'events' })).pipe(
      map((event: HttpEvent<unknown>): UploadProgress | null => {
        if (event.type === HttpEventType.UploadProgress) {
          return { kind: 'progress', percent: event.total ? Math.round((event.loaded / event.total) * 100) : 0 };
        }
        if (event.type === HttpEventType.Response) {
          return { kind: 'done', attachment: attachmentFromResponse(event.body, taskId) };
        }
        return null;
      }),
      filter((value): value is UploadProgress => value !== null),
    );
  }

  /** URL assinada de curta duração; deve ser usada imediatamente. */
  downloadUrl(taskId: string, attachmentId: string): Observable<string> {
    return this.request(taskId, (url) => this.http.get<unknown>(`${url}/${encodeURIComponent(attachmentId)}/download`)).pipe(
      map((value) => {
        if (typeof value !== 'object' || value === null || !('url' in value) || typeof value.url !== 'string' ||
          !/^https?:\/\//.test(value.url)) {
          throw new Error('Resposta de download inválida.');
        }
        return value.url;
      }),
    );
  }

  remove(taskId: string, attachmentId: string): Observable<void> {
    return this.request(taskId, (url) => this.http.delete<void>(`${url}/${encodeURIComponent(attachmentId)}`)).pipe(map(() => undefined));
  }

  private request<T>(taskId: string, send: (url: string) => Observable<T>): Observable<T> {
    return defer(() => {
      const organizationId = this.activeId();
      if (!organizationId) return throwError(() => new Error('Selecione uma organização.'));
      const url = `${this.base}/organizations/${encodeURIComponent(organizationId)}/tasks/${encodeURIComponent(taskId)}/attachments`;
      return send(url).pipe(
        takeUntil(this.contextChanged),
        map((result) => {
          if (this.activeId() !== organizationId) throw new Error('A organização ativa mudou.');
          return result;
        }),
      );
    });
  }
}
