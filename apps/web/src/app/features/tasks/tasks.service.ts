import { HttpClient, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { Observable, Subject, defer, map, takeUntil, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { OrganizationsService } from '../organizations/organizations.service';
import { DashboardSummary } from '../dashboard/dashboard.models';
import { CreateTask, Task, TaskPage, TaskQuery, TaskRecord, UpdateTask } from './task.models';

@Injectable()
export class TasksService {
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

  list(query: TaskQuery): Observable<TaskPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== '') params = params.set(key, String(value));
    }
    return this.request((url) => this.http.get<TaskPage>(url, { params }), (result, id) => {
      if (!result || !Array.isArray(result.data) || !result.meta ||
        !Number.isInteger(result.meta.page) || result.meta.page < 1 ||
        !Number.isInteger(result.meta.limit) || result.meta.limit < 1 ||
        !Number.isInteger(result.meta.total) || result.meta.total < 0 ||
        !Number.isInteger(result.meta.totalPages) || result.meta.totalPages < 0 ||
        result.data.some((task) => !task || task.organizationId !== id)) {
        throw new Error('Resposta de tarefas inválida.');
      }
      return result;
    });
  }

  summary(): Observable<DashboardSummary> {
    return this.request((url) => this.http.get<DashboardSummary>(`${url}/summary`), (result, id) => {
      const statuses = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
      const validTask = (task: DashboardSummary['myTasks'][number]): boolean =>
        !!task && task.organizationId === id && typeof task.id === 'string' && !!task.id &&
        typeof task.title === 'string' && !!task.title &&
        statuses.includes(task.status) && typeof task.updatedAt === 'string' &&
        !Number.isNaN(Date.parse(task.updatedAt)) &&
        (task.dueDate === null || (typeof task.dueDate === 'string' && !Number.isNaN(Date.parse(task.dueDate))));
      if (!result || !result.counts || !Number.isInteger(result.total) || result.total < 0 ||
        statuses.some((status) => !Number.isInteger(result.counts[status]) || result.counts[status] < 0) ||
        statuses.reduce((total, status) => total + result.counts[status], 0) !== result.total ||
        Number.isNaN(Date.parse(result.asOf)) || Number.isNaN(Date.parse(result.dueUntil)) ||
        Date.parse(result.asOf) > Date.parse(result.dueUntil) ||
        [result.myTasks, result.dueSoon, result.recentlyUpdated].some((tasks) =>
          !Array.isArray(tasks) || tasks.some((task) => !validTask(task)))) {
        throw new Error('Resposta do dashboard inválida.');
      }
      return result;
    });
  }

  detail(taskId: string): Observable<Task> {
    return this.request((url) => this.http.get<Task>(`${url}/${encodeURIComponent(taskId)}`), this.checkTask);
  }

  create(data: CreateTask): Observable<TaskRecord> {
    return this.request((url) => this.http.post<TaskRecord>(url, data), this.checkTask);
  }

  update(taskId: string, data: UpdateTask): Observable<Task> {
    return this.request((url) => this.http.put<Task>(`${url}/${encodeURIComponent(taskId)}`, data), this.checkTask);
  }

  delete(taskId: string, version: number): Observable<void> {
    return this.request((url) => this.http.delete<void>(`${url}/${encodeURIComponent(taskId)}`, {
      params: new HttpParams().set('version', version),
    }), (result) => result);
  }

  private request<T>(send: (url: string) => Observable<T>, check: (result: T, organizationId: string) => T): Observable<T> {
    return defer(() => {
      const organizationId = this.activeId();
      if (!organizationId) return throwError(() => new Error('Selecione uma organização.'));
      const url = `${this.base}/organizations/${encodeURIComponent(organizationId)}/tasks`;
      return send(url).pipe(
        takeUntil(this.contextChanged),
        map((result) => {
          if (this.activeId() !== organizationId) throw new Error('A organização ativa mudou.');
          return check(result, organizationId);
        }),
      );
    });
  }

  private checkTask<T extends TaskRecord>(task: T, organizationId: string): T {
    if (!task || task.organizationId !== organizationId) throw new Error('Resposta de tarefa inválida.');
    return task;
  }
}
