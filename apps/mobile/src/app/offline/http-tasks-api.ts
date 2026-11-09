import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../core/api-base-url';
import { ApiError, TaskPage, TasksApi } from './tasks-api';
import { Member, Project, ServerTask, TaskFields, serverTaskFromResponse } from './task.models';

export interface OrganizationSummary {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

/** Cliente HTTP da API para o app; converte falhas em `ApiError`. */
@Injectable({ providedIn: 'root' })
export class HttpTasksApi implements TasksApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');

  async list(organizationId: string, page: number, limit: number): Promise<TaskPage> {
    const body = await this.call(this.http.get<{ data: unknown[]; meta: { totalPages: number } }>(this.tasks(organizationId), {
      params: { page, limit, sortBy: 'updatedAt', sortOrder: 'desc' },
    }));
    return { data: body.data.map(serverTaskFromResponse), totalPages: body.meta.totalPages };
  }

  async get(organizationId: string, taskId: string): Promise<ServerTask> {
    return serverTaskFromResponse(await this.call(this.http.get(`${this.tasks(organizationId)}/${encodeURIComponent(taskId)}`)));
  }

  async create(organizationId: string, body: TaskFields & { id: string }): Promise<ServerTask> {
    // A criação não aceita nulos: campos vazios são omitidos.
    const payload = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null));
    return serverTaskFromResponse(await this.call(this.http.post(this.tasks(organizationId), payload)));
  }

  async update(organizationId: string, taskId: string, body: Partial<TaskFields> & { version: number }): Promise<ServerTask> {
    return serverTaskFromResponse(await this.call(this.http.put(`${this.tasks(organizationId)}/${encodeURIComponent(taskId)}`, body)));
  }

  async remove(organizationId: string, taskId: string, version: number): Promise<void> {
    await this.call(this.http.delete(`${this.tasks(organizationId)}/${encodeURIComponent(taskId)}`, { params: { version } }));
  }

  async organizations(): Promise<OrganizationSummary[]> {
    const rows = await this.call(this.http.get<{ id: string; name: string; memberships: { role: OrganizationSummary['role'] }[] }[]>(
      `${this.base}/organizations`,
    ));
    return rows.map((row) => ({ id: row.id, name: row.name, role: row.memberships[0]?.role ?? 'MEMBER' }));
  }

  async members(organizationId: string): Promise<Member[]> {
    const rows = await this.call(this.http.get<{ user: Member }[]>(`${this.organization(organizationId)}/members`));
    return rows.map((row) => ({ id: row.user.id, name: row.user.name }));
  }

  async projects(organizationId: string): Promise<Project[]> {
    const rows = await this.call(this.http.get<Project[]>(`${this.organization(organizationId)}/projects`));
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  private organization(organizationId: string): string {
    return `${this.base}/organizations/${encodeURIComponent(organizationId)}`;
  }

  private tasks(organizationId: string): string {
    return `${this.organization(organizationId)}/tasks`;
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error: unknown) {
      if (error instanceof HttpErrorResponse) throw new ApiError(error.status, error.error);
      throw new ApiError(0);
    }
  }
}
