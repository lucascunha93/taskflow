import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { TaskQuery } from './task.models';
import { TasksService } from './tasks.service';

const first: Organization = { id: 'one', name: 'Equipe A', slug: 'a', createdAt: '2026-01-01', role: 'MEMBER' };
const active = signal<Organization | null>(first);
const task = {
  id: 'task-1', organizationId: 'one', title: 'Tarefa', description: null, status: 'TODO' as const,
  creatorId: 'user-1', assigneeId: null, version: 3, dueDate: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  creator: { id: 'user-1', name: 'Pessoa A' }, assignee: null,
};
const query: TaskQuery = {
  page: 2, limit: 20, status: 'DONE', assigneeId: 'user-2', creatorId: 'user-1', projectId: 'project-1', search: 'teste',
  dueDateFrom: '2026-01-01', dueDateTo: '2026-01-31', sortBy: 'title', sortOrder: 'asc',
};

describe('TasksService', () => {
  let service: TasksService;
  let http: HttpTestingController;

  beforeEach(() => {
    active.set(first);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(), TasksService,
      { provide: API_BASE_URL, useValue: '/api' },
      { provide: OrganizationsService, useValue: { active } },
    ] });
    service = TestBed.inject(TasksService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  });
  afterEach(() => http.verify());

  it('sends pagination, all filters and ordering and returns the paginated response', async () => {
    const result = firstValueFrom(service.list(query));
    const request = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(request.request.method).toBe('GET');
    for (const [key, value] of Object.entries(query)) expect(request.request.params.get(key)).toBe(String(value));
    const page = { data: [task], meta: { page: 2, limit: 20, total: 25, totalPages: 2 } };
    request.flush(page);
    await expect(result).resolves.toEqual(page);
  });

  it('calls create, detail, update and versioned delete with their real contracts', async () => {
    const create = firstValueFrom(service.create({ title: 'Tarefa', status: 'IN_PROGRESS', assigneeId: 'user-2' }));
    const post = http.expectOne('/api/organizations/one/tasks');
    expect(post.request.body).toEqual({ title: 'Tarefa', status: 'IN_PROGRESS', assigneeId: 'user-2' });
    post.flush(task);
    await create;
    const detail = firstValueFrom(service.detail(task.id));
    http.expectOne('/api/organizations/one/tasks/task-1').flush(task);
    await expect(detail).resolves.toEqual(task);
    const update = firstValueFrom(service.update(task.id, { version: 3, description: null, assigneeId: null }));
    const put = http.expectOne('/api/organizations/one/tasks/task-1');
    expect(put.request.body).toEqual({ version: 3, description: null, assigneeId: null });
    put.flush({ ...task, version: 4 });
    expect((await update).version).toBe(4);
    const remove = firstValueFrom(service.delete(task.id, 4));
    const deletion = http.expectOne((req) => req.url === '/api/organizations/one/tasks/task-1');
    expect(deletion.request.method).toBe('DELETE');
    expect(deletion.request.params.get('version')).toBe('4');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await remove;
  });

  it('cancels a request on organization change and rejects cross-tenant results', async () => {
    const subscription = service.detail(task.id).subscribe();
    const request = http.expectOne('/api/organizations/one/tasks/task-1');
    active.set({ ...first, id: 'two' });
    TestBed.tick();
    expect(request.cancelled).toBe(true);
    expect(subscription.closed).toBe(true);
    const result = firstValueFrom(service.detail(task.id));
    http.expectOne('/api/organizations/two/tasks/task-1').flush(task);
    await expect(result).rejects.toThrow('Resposta de tarefa inválida');
  });

  it('does not send requests without an active organization', async () => {
    active.set(null);
    TestBed.tick();
    await expect(firstValueFrom(service.list(query))).rejects.toThrow('Selecione uma organização');
    http.expectNone((req) => req.url.includes('/tasks'));
  });

  it('rejects a response that arrives after a context switch before cancellation runs', async () => {
    const result = firstValueFrom(service.detail(task.id));
    const request = http.expectOne('/api/organizations/one/tasks/task-1');
    active.set({ ...first, id: 'two' });
    request.flush(task);
    await expect(result).rejects.toThrow('A organização ativa mudou');
    TestBed.tick();
  });

  it('rejects malformed pagination instead of showing an empty success', async () => {
    const result = firstValueFrom(service.list(query));
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush({ data: [], meta: {} });
    await expect(result).rejects.toThrow('Resposta de tarefas inválida');
  });
});
