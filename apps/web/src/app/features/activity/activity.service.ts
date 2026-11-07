import { HttpClient, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { Observable, Subject, defer, map, takeUntil, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { OrganizationsService } from '../organizations/organizations.service';
import { ActivityPage, activityPageFromResponse } from './activity.models';

/** Histórico da organização ativa; requisições são canceladas ao trocar de organização. */
@Injectable()
export class ActivityService {
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

  organization(limit = 10, before: string | null = null): Observable<ActivityPage> {
    return this.page('/activity', limit, before);
  }

  task(taskId: string, limit = 20, before: string | null = null): Observable<ActivityPage> {
    return this.page(`/tasks/${encodeURIComponent(taskId)}/activity`, limit, before);
  }

  private page(path: string, limit: number, before: string | null): Observable<ActivityPage> {
    return defer(() => {
      const organizationId = this.activeId();
      if (!organizationId) return throwError(() => new Error('Selecione uma organização.'));
      let params = new HttpParams().set('limit', limit);
      if (before) params = params.set('before', before);
      return this.http.get<unknown>(`${this.base}/organizations/${encodeURIComponent(organizationId)}${path}`, { params }).pipe(
        takeUntil(this.contextChanged),
        map((result) => {
          if (this.activeId() !== organizationId) throw new Error('A organização ativa mudou.');
          return activityPageFromResponse(result);
        }),
      );
    });
  }
}
