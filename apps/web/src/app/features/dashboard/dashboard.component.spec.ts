import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { DashboardComponent } from './dashboard.component';
import { DashboardSummary } from './dashboard.models';

const first: Organization = { id: 'one', name: 'Equipe A', slug: 'a', createdAt: '2026-01-01', role: 'MEMBER' };
const active = signal<Organization | null>(first);
const task = {
  id: 't1', organizationId: 'one', title: 'Tarefa próxima', status: 'TODO' as const,
  dueDate: '2026-10-03T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
};
const summary: DashboardSummary = {
  total: 25, counts: { TODO: 10, IN_PROGRESS: 7, DONE: 5, CANCELLED: 3 },
  asOf: '2026-10-01T10:00:00.000Z', dueUntil: '2026-10-08T10:00:00.000Z',
  myTasks: [task], dueSoon: [task], recentlyUpdated: [task],
};

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let element: HTMLElement;
  let http: HttpTestingController;

  beforeEach(async () => {
    active.set(first);
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    // O detalhe da tarefa também carrega seus comentários, testados em seu próprio spec.
    for (const request of http.match((req) => req.url.endsWith('/comments'))) {
      if (!request.cancelled) request.flush({ data: [], nextCursor: null });
    }
    fixture.destroy();
    http.verify();
  });

  function load(value: DashboardSummary = summary): void {
    http.expectOne('/api/organizations/one/tasks/summary').flush(value);
  }
  function button(text: string): HTMLButtonElement {
    const result = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.includes(text));
    if (!result) throw new Error(`Button not found: ${text}`);
    return result;
  }

  it('renders real totals, distributions, assigned tasks and correctly labeled recent updates', async () => {
    expect(element.textContent).toContain('Carregando indicadores');
    load();
    await fixture.whenStable();
    expect(Array.from(element.querySelectorAll('.metric strong'), (item) => item.textContent?.trim()))
      .toEqual(['25', '10', '7', '5', '3']);
    expect(element.textContent).toContain('10 / 25');
    expect(element.querySelector<HTMLElement>('.bar span')?.style.width).toBe('40%');
    expect(element.textContent).toContain('Minhas tarefas');
    expect(element.textContent).toContain('Vence em breve');
    expect(element.textContent).toContain('Tarefas recentemente atualizadas');
    expect(element.textContent).toContain('não um histórico de atividades');
    expect(element.querySelectorAll('app-dashboard-task-list')).toHaveLength(3);
  });

  it('shows zero indicators and empty lists without inventing activity', async () => {
    load({ ...summary, total: 0, counts: { TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 }, myTasks: [], dueSoon: [], recentlyUpdated: [] });
    await fixture.whenStable();
    expect(element.textContent).toContain('Ainda não há tarefas nesta organização');
    expect(element.textContent).toContain('Nenhuma tarefa atribuída a você');
    expect(element.querySelectorAll('.bar')).toHaveLength(0);
  });

  it('reports API failure and retries', async () => {
    http.expectOne('/api/organizations/one/tasks/summary').flush({}, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Organização não encontrada');
    button('Tentar novamente').click();
    await fixture.whenStable();
    load();
    await fixture.whenStable();
    expect(element.textContent).toContain('25');
  });

  it('opens the actual task detail and returns to the dashboard', async () => {
    load();
    await fixture.whenStable();
    button('Tarefa próxima').click();
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/tasks/t1').flush({
      ...task, description: null, creatorId: 'u1', assigneeId: null, version: 1,
      createdAt: task.updatedAt, creator: { id: 'u1', name: 'Pessoa A' }, assignee: null,
    });
    await fixture.whenStable();
    expect(element.textContent).toContain('Criador');
    expect(element.textContent).toContain('Pessoa A');
    button('Voltar às tarefas').click();
    await fixture.whenStable();
    expect(element.textContent).toContain('Visão geral');
  });

  it('reloads indicators after a task is deleted from its details', async () => {
    load();
    await fixture.whenStable();
    button('Tarefa próxima').click();
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/tasks/t1').flush({
      ...task, description: null, creatorId: 'u1', assigneeId: null, version: 3,
      createdAt: task.updatedAt, creator: { id: 'u1', name: 'Pessoa A' }, assignee: null,
    });
    await fixture.whenStable();
    button('Excluir tarefa').click();
    await fixture.whenStable();
    button('Confirmar exclusão').click();
    const request = http.expectOne('/api/organizations/one/tasks/t1?version=3');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    load({ ...summary, total: 0, counts: { TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 }, myTasks: [], dueSoon: [], recentlyUpdated: [] });
    await fixture.whenStable();
    expect(element.textContent).toContain('Tarefa excluída');
    expect(element.textContent).toContain('Ainda não há tarefas');
  });

  it('cancels the old request and never shows previous tenant data on switch', async () => {
    const old = http.expectOne('/api/organizations/one/tasks/summary');
    active.set({ ...first, id: 'two', name: 'Equipe B' });
    await fixture.whenStable();
    expect(old.cancelled).toBe(true);
    const next = http.expectOne('/api/organizations/two/tasks/summary');
    next.flush({ ...summary, myTasks: [], dueSoon: [], recentlyUpdated: [], total: 0, counts: { TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 } });
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Tarefa próxima');
    expect(element.textContent).toContain('Ainda não há tarefas');
  });

  it('rejects tasks from another tenant and shows an error', async () => {
    load({ ...summary, myTasks: [{ ...task, organizationId: 'two' }] });
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Tarefa próxima');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar');
  });

  it('ignores a late response even before the context effect runs', async () => {
    const old = http.expectOne('/api/organizations/one/tasks/summary');
    active.set({ ...first, id: 'two' });
    old.flush(summary);
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Tarefa próxima');
    http.expectOne('/api/organizations/two/tasks/summary').flush({
      ...summary, total: 0, counts: { TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 },
      myTasks: [], dueSoon: [], recentlyUpdated: [],
    });
    await fixture.whenStable();
    expect(element.textContent).toContain('Ainda não há tarefas');
  });

  it('only highlights upcoming or overdue open tasks', async () => {
    load({ ...summary, myTasks: [
      task,
      { ...task, id: 't2', title: 'Tarefa atrasada', dueDate: '2026-09-30T10:00:00.000Z' },
      { ...task, id: 't3', title: 'Tarefa concluída', status: 'DONE' as const, dueDate: '2026-09-30T10:00:00.000Z' },
    ] });
    await fixture.whenStable();
    const mine = element.querySelector('app-dashboard-task-list');
    expect(mine?.textContent).toContain('Vence em breve');
    expect(mine?.textContent).toContain('Atrasada');
    expect(mine?.textContent?.match(/Atrasada/g)).toHaveLength(1);
  });

  it('rejects malformed task dates rather than rendering invalid data', async () => {
    load({ ...summary, myTasks: [{ ...task, updatedAt: 'invalid' }] });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
  });
});
