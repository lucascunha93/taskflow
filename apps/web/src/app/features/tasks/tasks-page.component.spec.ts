import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { TasksPageComponent } from './tasks-page.component';

const first: Organization = { id: 'one', name: 'Equipe A', slug: 'a', createdAt: '2026-01-01', role: 'MEMBER' };
const active = signal<Organization | null>(first);
const members = [{ id: 'm1', role: 'MEMBER', createdAt: '2026-01-01', user: { id: 'u1', name: 'Pessoa A', email: 'a@example.test' } }];
const task = {
  id: 't1', organizationId: 'one', title: 'Tarefa original', description: 'Descrição',
  status: 'TODO', creatorId: 'u1', assigneeId: 'u1', version: 3, dueDate: null,
  createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z',
  creator: { id: 'u1', name: 'Pessoa A' }, assignee: { id: 'u1', name: 'Pessoa A' },
};
const page = { data: [task], meta: { page: 1, limit: 20, total: 25, totalPages: 2 } };

describe('TasksPageComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TasksPageComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    active.set(first);
    TestBed.configureTestingModule({
      imports: [TasksPageComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active, status: signal('ready'), refresh: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TasksPageComponent);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  function load(): void {
    http.expectOne('/api/organizations/one/members').flush(members);
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush(page);
  }
  function button(text: string): HTMLButtonElement {
    const result = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
    if (!result) throw new Error(`Button not found: ${text}`);
    return result;
  }
  function input(id: string, value: string): void {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (!field) throw new Error(`Field not found: ${id}`);
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }
  function submit(): void {
    const form = element.querySelector('app-task-form form');
    if (!form) throw new Error('Task form not found');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  function openTask(): void {
    const row = element.querySelector<HTMLButtonElement>('.task-row');
    if (!row) throw new Error('Task row not found');
    row.click();
  }

  it('creates a task with status and assignee, then refreshes the list', async () => {
    expect(element.textContent).toContain('Carregando tarefas');
    load();
    await fixture.whenStable();
    expect(element.textContent).toContain('25 tarefas');
    button('Nova tarefa').click();
    await fixture.whenStable();
    submit();
    await fixture.whenStable();
    expect(element.textContent).toContain('Informe um título');
    input('task-title', ' Nova tarefa ');
    input('task-status', 'IN_PROGRESS');
    input('task-assignee', 'u1');
    submit();
    submit();
    const request = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ title: 'Nova tarefa', status: 'IN_PROGRESS', assigneeId: 'u1' });
    request.flush({ ...task, id: 't2', title: 'Nova tarefa', status: 'IN_PROGRESS' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Tarefa criada');
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush(page);
  });

  it('shows details, sends partial update and handles conflict by requiring a reload before deletion', async () => {
    load();
    await fixture.whenStable();
    openTask();
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/tasks/t1').flush(task);
    await fixture.whenStable();
    expect(element.textContent).toContain('Descrição');
    button('Editar tarefa').click();
    await fixture.whenStable();
    input('task-title', 'Alterada');
    input('task-description', '');
    input('task-assignee', '');
    submit();
    const update = http.expectOne('/api/organizations/one/tasks/t1');
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({ version: 3, title: 'Alterada', description: null, assigneeId: null });
    update.flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(element.textContent).toContain('alterada por outra operação');
    expect(button('Salvar tarefa').disabled).toBe(true);
    button('Recarregar tarefa').click();
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/tasks/t1').flush({ ...task, version: 4 });
    await fixture.whenStable();
    button('Excluir tarefa').click();
    await fixture.whenStable();
    expect(element.textContent).toContain('Esta ação não pode ser desfeita');
    button('Confirmar exclusão').click();
    const deletion = http.expectOne((req) => req.url === '/api/organizations/one/tasks/t1');
    expect(deletion.request.params.get('version')).toBe('4');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Tarefa excluída');
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it('debounces filter changes, resets pagination and applies sorting', async () => {
    load();
    await fixture.whenStable();
    button('Próxima').click();
    await fixture.whenStable();
    const pageTwo = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(pageTwo.request.params.get('page')).toBe('2');
    pageTwo.flush({ ...page, meta: { ...page.meta, page: 2 } });
    await fixture.whenStable();
    input('filter-search', 't');
    input('filter-search', 'tarefa');
    input('filter-status', 'DONE');
    input('filter-assignee', 'u1');
    input('filter-creator', 'u1');
    input('filter-from', '2026-01-01');
    input('filter-to', '2026-01-31');
    input('filter-sort', 'title');
    input('filter-order', 'asc');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    const filtered = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(filtered.request.params.get('page')).toBe('1');
    expect(filtered.request.params.get('search')).toBe('tarefa');
    expect(filtered.request.params.get('status')).toBe('DONE');
    expect(filtered.request.params.get('assigneeId')).toBe('u1');
    expect(filtered.request.params.get('creatorId')).toBe('u1');
    expect(filtered.request.params.get('dueDateFrom')).toBe('2026-01-01');
    expect(filtered.request.params.get('dueDateTo')).toBe('2026-01-31');
    expect(filtered.request.params.get('sortBy')).toBe('title');
    expect(filtered.request.params.get('sortOrder')).toBe('asc');
    filtered.flush({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await fixture.whenStable();
    expect(element.textContent).toContain('Nenhuma tarefa encontrada');
  });

  it('updates with the loaded version and refreshes the list on success', async () => {
    load();
    await fixture.whenStable();
    openTask();
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/tasks/t1').flush({ ...task, dueDate: '2026-01-30T12:30:45.000Z' });
    await fixture.whenStable();
    button('Editar tarefa').click();
    await fixture.whenStable();
    input('task-status', 'DONE');
    input('task-due', '');
    submit();
    const request = http.expectOne('/api/organizations/one/tasks/t1');
    expect(request.request.body).toEqual({ version: 3, status: 'DONE', dueDate: null });
    request.flush({ ...task, status: 'DONE', version: 4 });
    await fixture.whenStable();
    expect(element.textContent).toContain('Tarefa atualizada');
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush(page);
  });

  it('reports delete conflicts and disables retry until the task is reloaded', async () => {
    load();
    await fixture.whenStable();
    openTask();
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/tasks/t1').flush(task);
    await fixture.whenStable();
    button('Excluir tarefa').click();
    await fixture.whenStable();
    button('Confirmar exclusão').click();
    const deletion = http.expectOne((req) => req.url === '/api/organizations/one/tasks/t1');
    deletion.flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(element.textContent).toContain('alterada por outra operação');
    expect(button('Confirmar exclusão').disabled).toBe(true);
    expect(button('Recarregar tarefa').disabled).toBe(false);
  });

  it('does not send an invalid due-date range', async () => {
    load();
    await fixture.whenStable();
    input('filter-from', '2026-02-01');
    input('filter-to', '2026-01-01');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    expect(element.textContent).toContain('Os filtros ainda não foram aplicados');
    http.expectNone((req) => req.url === '/api/organizations/one/tasks');
  });

  it('requires returning to a refreshed list after an uncertain creation result', async () => {
    load();
    await fixture.whenStable();
    button('Nova tarefa').click();
    await fixture.whenStable();
    input('task-title', 'Nova tarefa');
    submit();
    http.expectOne((req) => req.url === '/api/organizations/one/tasks')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.textContent).toContain('Não foi possível confirmar a criação');
    expect(button('Salvar tarefa').disabled).toBe(true);
    button('Cancelar').click();
    await fixture.whenStable();
    expect(element.textContent).toContain('Confira a lista');
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush(page);
  });

  it('cancels a pending creation after switching the active organization', async () => {
    load();
    await fixture.whenStable();
    button('Nova tarefa').click();
    await fixture.whenStable();
    input('task-title', 'Nova tarefa');
    submit();
    const creation = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    active.set({ ...first, id: 'two', name: 'Equipe B' });
    await fixture.whenStable();
    expect(creation.cancelled).toBe(true);
    expect(element.querySelector('app-task-form')).toBeNull();
    http.expectOne('/api/organizations/two/members').flush([]);
    http.expectOne((req) => req.url === '/api/organizations/two/tasks').flush({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it('hides old tenant data immediately and cancels pending detail on organization change', async () => {
    load();
    await fixture.whenStable();
    openTask();
    await fixture.whenStable();
    const detail = http.expectOne('/api/organizations/one/tasks/t1');
    active.set({ ...first, id: 'two', name: 'Equipe B' });
    await fixture.whenStable();
    expect(detail.cancelled).toBe(true);
    expect(element.textContent).not.toContain('Tarefa original');
    http.expectOne('/api/organizations/two/members').flush([]);
    http.expectOne((req) => req.url === '/api/organizations/two/tasks').flush({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await fixture.whenStable();
    expect(element.textContent).toContain('Equipe B');
  });
});
