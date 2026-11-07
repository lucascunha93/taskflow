import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { ActivityFeedComponent } from './activity-feed.component';
import { Activity, activityPageFromResponse, describeActivity } from './activity.models';

const base: Activity = {
  id: 'a1', type: 'TASK_UPDATED', taskId: 't1', taskTitle: 'Relatório', createdAt: '2026-01-02T10:00:00Z',
  changes: [
    { field: 'status', from: 'TODO', to: 'IN_PROGRESS' },
    { field: 'assignee', from: null, to: 'Ana' },
    { field: 'description', from: null, to: null },
  ],
  actor: { id: 'u1', name: 'Bruno' },
};

describe('activity descriptions', () => {
  it('describes updates with readable labels and values', () => {
    expect(describeActivity(base)).toBe(
      'alterou “Relatório”: o status de “A fazer” para “Em andamento”; o responsável de “sem responsável” para “Ana”; a descrição',
    );
    expect(describeActivity(base, false)).toBe(
      'alterou o status de “A fazer” para “Em andamento”; o responsável de “sem responsável” para “Ana”; a descrição',
    );
  });

  it('describes the other event types', () => {
    expect(describeActivity({ ...base, type: 'TASK_CREATED', changes: null })).toBe('criou a tarefa “Relatório”');
    expect(describeActivity({ ...base, type: 'TASK_DELETED', taskId: null, changes: null })).toBe('excluiu a tarefa “Relatório”');
    expect(describeActivity({ ...base, type: 'COMMENT_ADDED', changes: null }, false)).toBe('comentou');
  });

  it('rejects malformed responses', () => {
    expect(() => activityPageFromResponse({ data: [{ ...base, type: 'OTHER' }], nextCursor: null })).toThrow();
    expect(() => activityPageFromResponse({ data: [{ ...base, changes: [{ field: 'secret', from: null, to: null }] }], nextCursor: null })).toThrow();
    expect(activityPageFromResponse({ data: [base], nextCursor: 'a1' }).data[0]).toEqual(base);
  });
});

describe('ActivityFeedComponent', () => {
  const organization: Organization = { id: 'one', name: 'Equipe', slug: 'equipe', createdAt: '2026-01-01', role: 'MEMBER' };
  let http: HttpTestingController;

  async function render(taskId: string | null) {
    TestBed.configureTestingModule({
      imports: [ActivityFeedComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active: signal(organization) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ActivityFeedComponent);
    fixture.componentRef.setInput('taskId', taskId);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('loads the organization feed, opens existing tasks and pages older activity', async () => {
    const fixture = await render(null);
    const element = fixture.nativeElement as HTMLElement;
    const first = http.expectOne((req) => req.url === '/api/organizations/one/activity');
    expect(first.request.params.get('limit')).toBe('10');
    first.flush({ data: [base, { ...base, id: 'a2', type: 'TASK_DELETED', taskId: null, changes: null }], nextCursor: 'a2' });
    await fixture.whenStable();
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((id) => opened.push(id));
    const links = element.querySelectorAll<HTMLButtonElement>('.link-button:not(:disabled)');
    expect(element.textContent).toContain('Bruno');
    expect(element.textContent).toContain('excluiu a tarefa “Relatório”');
    Array.from(links).find((item) => item.textContent?.includes('alterou'))?.click();
    expect(opened).toEqual(['t1']);
    Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.includes('anteriores'))?.click();
    const older = http.expectOne((req) => req.url === '/api/organizations/one/activity' && req.params.get('before') === 'a2');
    older.flush({ data: [{ ...base, id: 'a3', type: 'TASK_CREATED', changes: null }], nextCursor: null });
    await fixture.whenStable();
    expect(element.querySelectorAll('li')).toHaveLength(3);
    fixture.destroy();
  });

  it('shows the task history without task links and reports failures', async () => {
    const fixture = await render('t1');
    const element = fixture.nativeElement as HTMLElement;
    http.expectOne((req) => req.url === '/api/organizations/one/tasks/t1/activity').flush({ data: [base], nextCursor: null });
    await fixture.whenStable();
    expect(element.textContent).toContain('alterou o status');
    expect(element.textContent).not.toContain('“Relatório”');
    Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === 'Atualizar')?.click();
    await fixture.whenStable();
    http.expectOne((req) => req.url === '/api/organizations/one/tasks/t1/activity').flush({}, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Histórico indisponível');
    fixture.destroy();
  });
});
