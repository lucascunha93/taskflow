import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, Subject, defer, map, takeUntil, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { OrganizationsService } from '../organizations/organizations.service';
import { Project, ProjectInput, projectFromResponse } from './project.models';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Projetos da organização ativa. A lista é carregada automaticamente e
 * descartada ao trocar de organização; mutações atualizam a lista local.
 */
@Injectable()
export class ProjectsService {
  private readonly http = inject(HttpClient);
  private readonly organizations = inject(OrganizationsService);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private readonly contextId = signal<string | null>(null);
  private readonly projectsState = signal<Project[]>([]);
  private readonly statusState = signal<Status>('idle');
  private readonly reload = signal(0);
  private readonly contextChanged = new Subject<void>();
  private readonly current = computed(() => this.contextId() !== null && this.contextId() === this.activeId());

  readonly projects = computed(() => this.current() ? this.projectsState() : []);
  readonly status = computed<Status>(() => !this.activeId() ? 'idle' : this.current() ? this.statusState() : 'loading');

  constructor() {
    effect((onCleanup) => {
      const organizationId = this.activeId();
      this.reload();
      this.contextChanged.next();
      this.contextId.set(organizationId);
      this.projectsState.set([]);
      if (!organizationId) {
        this.statusState.set('idle');
        return;
      }
      this.statusState.set('loading');
      const request = this.http.get<unknown>(this.url(organizationId)).pipe(map((value) => {
        if (!Array.isArray(value)) throw new Error('Resposta de projetos inválida.');
        return value.map((item: unknown) => projectFromResponse(item, organizationId));
      })).subscribe({
        next: (projects) => {
          if (this.activeId() !== organizationId) return;
          this.projectsState.set(projects);
          this.statusState.set('ready');
        },
        error: () => {
          if (this.activeId() !== organizationId) return;
          this.statusState.set('error');
        },
      });
      onCleanup(() => request.unsubscribe());
    });
    inject(DestroyRef).onDestroy(() => {
      this.contextChanged.next();
      this.contextChanged.complete();
    });
  }

  refresh(): void {
    this.reload.update((value) => value + 1);
  }

  get(projectId: string): Observable<Project> {
    return this.request((organizationId) => this.http.get<unknown>(`${this.url(organizationId)}/${encodeURIComponent(projectId)}`));
  }

  create(input: ProjectInput): Observable<Project> {
    return this.request((organizationId) => this.http.post<unknown>(this.url(organizationId), {
      name: input.name, ...(input.description ? { description: input.description } : {}),
    })).pipe(tap((project) => this.projectsState.update((projects) =>
      [...projects, project].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))));
  }

  update(projectId: string, input: ProjectInput): Observable<Project> {
    return this.request((organizationId) => this.http.patch<unknown>(`${this.url(organizationId)}/${encodeURIComponent(projectId)}`, input))
      .pipe(tap((project) => this.projectsState.update((projects) =>
        projects.map((item) => item.id === project.id ? project : item).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))));
  }

  remove(projectId: string): Observable<void> {
    return defer(() => {
      const organizationId = this.activeId();
      if (!organizationId) return throwError(() => new Error('Selecione uma organização.'));
      return this.http.delete<void>(`${this.url(organizationId)}/${encodeURIComponent(projectId)}`).pipe(
        takeUntil(this.contextChanged),
        tap(() => {
          if (this.activeId() === organizationId) {
            this.projectsState.update((projects) => projects.filter((item) => item.id !== projectId));
          }
        }),
      );
    });
  }

  private request(send: (organizationId: string) => Observable<unknown>): Observable<Project> {
    return defer(() => {
      const organizationId = this.activeId();
      if (!organizationId) return throwError(() => new Error('Selecione uma organização.'));
      return send(organizationId).pipe(
        takeUntil(this.contextChanged),
        map((value) => {
          if (this.activeId() !== organizationId) throw new Error('A organização ativa mudou.');
          return projectFromResponse(value, organizationId);
        }),
      );
    });
  }

  private url(organizationId: string): string {
    return `${this.base}/organizations/${encodeURIComponent(organizationId)}/projects`;
  }
}
