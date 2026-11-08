import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { AuthService } from '../../core/auth/auth.service';
import { Organization, OrganizationRole } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProjectBoardComponent } from './project-board.component';
import { ProjectsPageComponent } from './projects-page.component';

const org = (role: OrganizationRole): Organization => ({ id: 'one', name: 'Equipe', slug: 'equipe', createdAt: '2026-01-01', role });
const project = (id: string, name: string, taskCount = 0) => ({
  id, organizationId: 'one', name, description: null, taskCount, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});
const task = (id: string, status: string, version = 1) => ({
  id, organizationId: 'one', title: `Tarefa ${id}`, description: null, status, creatorId: 'u1', assigneeId: null,
  projectId: 'p1', version, dueDate: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  creator: { id: 'u1', name: 'Ana' }, assignee: null, project: { id: 'p1', name: 'Site' },
});
const page = (data: object[]) => ({ data, meta: { page: 1, limit: 100, total: data.length, totalPages: data.length ? 1 : 0 } });
const projectsUrl = '/api/organizations/one/projects';

describe('Projects', () => {
  const active = signal<Organization | null>(org('ADMIN'));
  const params = new BehaviorSubject(convertToParamMap({ projectId: 'p1' }));
  let http: HttpTestingController;

  beforeEach(() => {
    active.set(org('ADMIN'));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1', name: 'Ana', email: 'a@example.test', createdAt: '2026-01-01' }) } },
        { provide: ActivatedRoute, useValue: { paramMap: params, snapshot: { paramMap: params.value } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    for (const request of http.match((req) => ['/members', '/attachments', '/comments', '/activity'].some((end) => req.url.endsWith(end)))) {
      if (!request.cancelled) request.flush(['/members', '/attachments'].some((end) => request.request.url.endsWith(end)) ? [] : { data: [], nextCursor: null });
    }
    http.verify();
  });

  function button(element: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
    if (!found) throw new Error(`Button not found: ${text}`);
    return found;
  }
  function type(element: HTMLElement, selector: string, value: string): void {
    const field = element.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
    if (!field) throw new Error(`Field not found: ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  describe('ProjectsPageComponent', () => {
    let fixture: ComponentFixture<ProjectsPageComponent>;
    let element: HTMLElement;

    async function render(): Promise<void> {
      fixture = TestBed.createComponent(ProjectsPageComponent);
      await fixture.whenStable();
      element = fixture.nativeElement as HTMLElement;
    }

    it('hides management actions from members', async () => {
      active.set(org('MEMBER'));
      await render();
      http.expectOne(projectsUrl).flush([project('p1', 'Site', 2)]);
      await fixture.whenStable();
      expect(element.textContent).toContain('2 tarefas');
      expect(element.textContent).not.toContain('Novo projeto');
      expect(element.textContent).not.toContain('Excluir');
      fixture.destroy();
    });

    it('creates a project, reports duplicate names and deletes with confirmation', async () => {
      await render();
      http.expectOne(projectsUrl).flush([project('p1', 'Site')]);
      await fixture.whenStable();
      button(element, 'Novo projeto').click();
      await fixture.whenStable();
      type(element, '#project-name', '  Aplicativo ');
      element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      const post = http.expectOne((req) => req.url === projectsUrl && req.method === 'POST');
      expect(post.request.body).toEqual({ name: 'Aplicativo' });
      post.flush(project('p2', 'Aplicativo'));
      await fixture.whenStable();
      expect(Array.from(element.querySelectorAll('.project-name'), (link) => link.textContent)).toEqual(['Aplicativo', 'Site']);
      expect(element.textContent).toContain('Projeto criado');

      button(element, 'Novo projeto').click();
      await fixture.whenStable();
      type(element, '#project-name', 'Site');
      element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      http.expectOne((req) => req.url === projectsUrl && req.method === 'POST').flush({}, { status: 409, statusText: 'Conflict' });
      await fixture.whenStable();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('Já existe um projeto');
      button(element, 'Cancelar').click();
      await fixture.whenStable();

      button(element, 'Excluir').click();
      await fixture.whenStable();
      button(element, 'Confirmar exclusão').click();
      const deletion = http.expectOne(`${projectsUrl}/p2`);
      expect(deletion.request.method).toBe('DELETE');
      deletion.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      expect(element.textContent).toContain('As tarefas continuam na organização');
      expect(element.querySelectorAll('.project')).toHaveLength(1);
      fixture.destroy();
    });
  });

  describe('ProjectBoardComponent', () => {
    let fixture: ComponentFixture<ProjectBoardComponent>;
    let element: HTMLElement;

    async function render(tasks: Record<string, object[]> = {}): Promise<void> {
      fixture = TestBed.createComponent(ProjectBoardComponent);
      await fixture.whenStable();
      element = fixture.nativeElement as HTMLElement;
      http.expectOne(`${projectsUrl}/p1`).flush(project('p1', 'Site'));
      const columns = http.match((req) => req.url === '/api/organizations/one/tasks');
      expect(columns.map((req) => req.request.params.get('status'))).toEqual(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
      for (const request of columns) {
        expect(request.request.params.get('projectId')).toBe('p1');
        expect(request.request.params.get('limit')).toBe('100');
        request.flush(page(tasks[request.request.params.get('status') ?? ''] ?? []));
      }
      http.match(projectsUrl).forEach((request) => request.flush([project('p1', 'Site')]));
      await fixture.whenStable();
    }

    function column(status: string): HTMLElement {
      const found = element.querySelector<HTMLElement>(`[aria-labelledby="column-${status}"]`);
      if (!found) throw new Error(`Column not found: ${status}`);
      return found;
    }

    it('renders one column per status and moves a card with the loaded version', async () => {
      await render({ TODO: [task('t1', 'TODO', 3)] });
      expect(element.querySelector('h1')?.textContent).toBe('Site');
      expect(column('TODO').textContent).toContain('Tarefa t1');
      type(element, '.card select', 'DONE');
      const update = http.expectOne('/api/organizations/one/tasks/t1');
      expect(update.request.method).toBe('PUT');
      expect(update.request.body).toEqual({ version: 3, status: 'DONE' });
      update.flush({ ...task('t1', 'DONE', 4) });
      await fixture.whenStable();
      expect(column('TODO').textContent).toContain('Nenhuma tarefa');
      expect(column('DONE').textContent).toContain('Tarefa t1');
      expect(element.textContent).toContain('movida para Concluída');
      fixture.destroy();
    });

    it('reloads the board after a version conflict', async () => {
      await render({ TODO: [task('t1', 'TODO')] });
      type(element, '.card select', 'IN_PROGRESS');
      http.expectOne('/api/organizations/one/tasks/t1').flush({}, { status: 409, statusText: 'Conflict' });
      await fixture.whenStable();
      http.expectOne(`${projectsUrl}/p1`).flush(project('p1', 'Site'));
      for (const request of http.match((req) => req.url === '/api/organizations/one/tasks')) {
        request.flush(page(request.request.params.get('status') === 'IN_PROGRESS' ? [task('t1', 'IN_PROGRESS', 2)] : []));
      }
      await fixture.whenStable();
      expect(element.textContent).toContain('alterada por outra pessoa');
      expect(column('IN_PROGRESS').textContent).toContain('Tarefa t1');
      fixture.destroy();
    });

    it('creates tasks inside the project', async () => {
      await render();
      button(element, 'Nova tarefa').click();
      await fixture.whenStable();
      expect(element.querySelector<HTMLSelectElement>('#task-project')?.value).toBe('p1');
      type(element, '#task-title', 'Nova no quadro');
      element.querySelector('app-task-form form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      const post = http.expectOne((req) => req.url === '/api/organizations/one/tasks' && req.method === 'POST');
      expect(post.request.body).toEqual({ title: 'Nova no quadro', status: 'TODO', projectId: 'p1' });
      post.flush({ ...task('t9', 'TODO'), title: 'Nova no quadro' });
      await fixture.whenStable();
      http.expectOne(`${projectsUrl}/p1`).flush(project('p1', 'Site', 1));
      for (const request of http.match((req) => req.url === '/api/organizations/one/tasks')) request.flush(page([]));
      await fixture.whenStable();
      expect(element.textContent).toContain('Tarefa criada no projeto');
      fixture.destroy();
    });

    it('reports a project that does not exist in the organization', async () => {
      fixture = TestBed.createComponent(ProjectBoardComponent);
      await fixture.whenStable();
      element = fixture.nativeElement as HTMLElement;
      http.expectOne(`${projectsUrl}/p1`).flush({}, { status: 404, statusText: 'Not Found' });
      http.match((req) => req.url === '/api/organizations/one/tasks').forEach((request) => {
        if (!request.cancelled) request.flush(page([]));
      });
      http.match(projectsUrl).forEach((request) => request.flush([]));
      await fixture.whenStable();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('Projeto não encontrado');
      fixture.destroy();
    });
  });
});
