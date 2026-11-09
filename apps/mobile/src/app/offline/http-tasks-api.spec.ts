import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../core/api-base-url';
import { HttpTasksApi } from './http-tasks-api';
import { ApiError } from './tasks-api';

const task = {
  id: 't1', organizationId: 'o1', title: 'Tarefa', description: null, status: 'TODO', version: 2, creatorId: 'u1',
  assigneeId: null, projectId: null, dueDate: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  creator: { id: 'u1', name: 'Ana' },
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('HttpTasksApi', () => {
  let api: HttpTasksApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: 'https://api.example.test/' }],
    });
    api = TestBed.inject(HttpTasksApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the most recently updated tasks and keeps only known fields', async () => {
    const result = api.list('o1', 2, 100);
    const request = http.expectOne((req) => req.url === 'https://api.example.test/organizations/o1/tasks');
    expect(request.request.params.toString()).toBe('page=2&limit=100&sortBy=updatedAt&sortOrder=desc');
    request.flush({ data: [task], meta: { totalPages: 3 } });
    const page = await result;
    expect(page.totalPages).toBe(3);
    expect(page.data[0]).not.toHaveProperty('creator');
    expect(page.data[0]).toMatchObject({ id: 't1', version: 2 });
  });

  it('sends the client id on create and omits empty fields', async () => {
    const created = api.create('o1', {
      id: 't1', title: 'Tarefa', description: null, status: 'TODO', assigneeId: null, projectId: null, dueDate: null,
    });
    const request = http.expectOne('https://api.example.test/organizations/o1/tasks');
    expect(request.request.body).toEqual({ id: 't1', title: 'Tarefa', status: 'TODO' });
    request.flush(task);
    expect((await created).id).toBe('t1');
  });

  it('sends version on update and delete', async () => {
    const updated = api.update('o1', 't1', { version: 2, assigneeId: null });
    const put = http.expectOne('https://api.example.test/organizations/o1/tasks/t1');
    expect(put.request.body).toEqual({ version: 2, assigneeId: null });
    put.flush({ ...task, version: 3 });
    await updated;
    const removed = api.remove('o1', 't1', 3);
    http.expectOne('https://api.example.test/organizations/o1/tasks/t1?version=3').flush(null, { status: 204, statusText: 'No Content' });
    await removed;
  });

  it('converts HTTP failures into ApiError with status and body', async () => {
    const conflict = api.update('o1', 't1', { version: 1, title: 'X' });
    http.expectOne('https://api.example.test/organizations/o1/tasks/t1').flush(
      { message: 'A tarefa foi alterada.' }, { status: 409, statusText: 'Conflict' },
    );
    await expect(conflict).rejects.toMatchObject({ status: 409, apiMessage: 'A tarefa foi alterada.', transient: false });

    const offline = api.get('o1', 't1');
    http.expectOne('https://api.example.test/organizations/o1/tasks/t1').error(new ProgressEvent('error'), { status: 0 });
    const error = await offline.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).transient).toBe(true);
  });

  it('maps organizations, members and projects for offline use', async () => {
    const organizations = api.organizations();
    http.expectOne('https://api.example.test/organizations').flush([{ id: 'o1', name: 'Equipe', memberships: [{ role: 'ADMIN' }] }]);
    expect(await organizations).toEqual([{ id: 'o1', name: 'Equipe', role: 'ADMIN' }]);
    const members = api.members('o1');
    http.expectOne('https://api.example.test/organizations/o1/members').flush([{ id: 'm', role: 'MEMBER', user: { id: 'u2', name: 'Bia', email: 'b@x' } }]);
    expect(await members).toEqual([{ id: 'u2', name: 'Bia' }]);
    const projects = api.projects('o1');
    await settle();
    http.expectOne('https://api.example.test/organizations/o1/projects').flush([{ id: 'p1', name: 'Site', taskCount: 2 }]);
    expect(await projects).toEqual([{ id: 'p1', name: 'Site' }]);
  });
});
