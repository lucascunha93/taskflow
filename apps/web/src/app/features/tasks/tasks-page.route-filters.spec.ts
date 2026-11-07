import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { AuthService } from '../../core/auth/auth.service';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { TasksPageComponent } from './tasks-page.component';

const organization: Organization = { id: 'one', name: 'Equipe A', slug: 'a', createdAt: '2026-01-01', role: 'MEMBER' };
const members = [{ id: 'm1', role: 'MEMBER', createdAt: '2026-01-01', user: { id: 'me', name: 'Pessoa Atual', email: 'a@example.test' } }];
const emptyPage = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };

describe('TasksPageComponent route filters', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  async function create(query: Record<string, string>) {
    params = new BehaviorSubject(convertToParamMap(query));
    TestBed.configureTestingModule({
      imports: [TasksPageComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: ActivatedRoute, useValue: { queryParamMap: params, snapshot: { queryParamMap: params.value } } },
        { provide: AuthService, useValue: { user: signal({ id: 'me', name: 'Pessoa Atual', email: 'a@example.test', createdAt: '2026-01-01' }) } },
        { provide: OrganizationsService, useValue: { active: signal(organization), status: signal('ready'), refresh: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TasksPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/members').flush(members);
    return fixture;
  }

  afterEach(() => http.verify());

  it('lists the tasks assigned to the authenticated user for ?assignee=me', async () => {
    const fixture = await create({ assignee: 'me' });
    const request = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(request.request.params.get('assigneeId')).toBe('me');
    request.flush(emptyPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Minhas tarefas');
    expect(element.querySelector<HTMLSelectElement>('#filter-assignee')?.value).toBe('me');
  });

  it('applies the search from the URL and resets filters when the query changes', async () => {
    const fixture = await create({ search: '  relatório ' });
    const first = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(first.request.params.get('search')).toBe('relatório');
    expect(first.request.params.has('assigneeId')).toBe(false);
    first.flush(emptyPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toBe('Tarefas');
    expect(element.querySelector<HTMLInputElement>('#filter-search')?.value).toBe('relatório');

    params.next(convertToParamMap({}));
    await fixture.whenStable();
    const second = http.expectOne((req) => req.url === '/api/organizations/one/tasks');
    expect(second.request.params.has('search')).toBe(false);
    second.flush(emptyPage);
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('#filter-search')?.value).toBe('');
    fixture.destroy();
  });

  it('opens the task requested by ?task and removes the parameter when the detail closes', async () => {
    const taskId = '33333333-3333-4333-8333-333333333333';
    const fixture = await create({ task: taskId });
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush(emptyPage);
    const detail = http.expectOne(`/api/organizations/one/tasks/${taskId}`);
    detail.flush({
      id: taskId, organizationId: 'one', title: 'Aberta pela notificação', description: null, status: 'TODO',
      creatorId: 'me', assigneeId: null, version: 1, dueDate: null, createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z', creator: { id: 'me', name: 'Pessoa Atual' }, assignee: null,
    });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#detail-title')?.textContent).toBe('Aberta pela notificação');
    for (const request of http.match((req) => req.url.endsWith('/comments') || req.url.endsWith('/activity'))) {
      request.flush({ data: [], nextCursor: null });
    }
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    element.querySelector<HTMLButtonElement>('.back')?.click();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { task: null }, queryParamsHandling: 'merge' }));
    fixture.destroy();
  });

  it('ignores a malformed task parameter', async () => {
    const fixture = await create({ task: '../../etc' });
    http.expectOne((req) => req.url === '/api/organizations/one/tasks').flush(emptyPage);
    await fixture.whenStable();
    http.expectNone((req) => req.url.includes('/tasks/'));
    fixture.destroy();
  });
});
