import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { AuthService } from '../../core/auth/auth.service';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { AppNotification, describeNotification } from './notification.models';
import { NotificationsMenuComponent } from './notifications-menu.component';
import { NOTIFICATION_POLL_MS, NotificationsService } from './notifications.service';

const notification = (id: string, overrides: Partial<AppNotification> = {}): AppNotification => ({
  id, type: 'TASK_ASSIGNED', organizationId: 'two', organization: { id: 'two', name: 'Equipe B' },
  taskId: '33333333-3333-4333-8333-333333333333', taskTitle: 'Relatório', readAt: null,
  createdAt: '2026-01-02T10:00:00Z', actor: { id: 'u2', name: 'Ana' }, ...overrides,
});

describe('Notifications', () => {
  const sessionEnded = new Subject<void>();
  const status = signal<'authenticated' | 'unauthenticated'>('authenticated');
  const active = signal<Organization | null>({ id: 'one', name: 'Equipe A', slug: 'a', createdAt: '2026-01-01', role: 'MEMBER' });
  const select = vi.fn((id: string) => id === 'two');
  let http: HttpTestingController;
  let service: NotificationsService;

  beforeEach(() => {
    status.set('authenticated');
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: AuthService, useValue: { status, sessionEnded } },
        { provide: OrganizationsService, useValue: { active, select } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NotificationsService);
  });

  afterEach(() => {
    service.stop();
    http.verify();
  });

  const page = (data: AppNotification[], unreadCount = data.filter((item) => !item.readAt).length) =>
    ({ data, nextCursor: null, unreadCount });

  it('describes assignment and comment notifications', () => {
    expect(describeNotification(notification('n1'))).toBe('Ana atribuiu a você “Relatório”');
    expect(describeNotification(notification('n2', { type: 'TASK_COMMENTED' }))).toBe('Ana comentou em “Relatório”');
  });

  it('polls only once per interval, while visible, and clears everything when the session ends', async () => {
    vi.useFakeTimers();
    try {
      service.start();
      service.start();
      await vi.advanceTimersByTimeAsync(0);
      const first = http.expectOne((req) => req.url === '/api/notifications');
      expect(first.request.params.get('limit')).toBe('20');
      first.flush(page([notification('n1')]));
      expect(service.unreadCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
      http.expectOne((req) => req.url === '/api/notifications').flush(page([notification('n1'), notification('n2')]));
      expect(service.items()).toHaveLength(2);
      sessionEnded.next();
      expect(service.items()).toEqual([]);
      expect(service.unreadCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
      http.expectNone((req) => req.url === '/api/notifications');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks a notification as read optimistically and restores it if the API fails', () => {
    service.refresh();
    http.expectOne((req) => req.url === '/api/notifications').flush(page([notification('n1'), notification('n2')]));
    service.markRead(service.items()[0]);
    expect(service.unreadCount()).toBe(1);
    expect(service.items()[0].readAt).not.toBeNull();
    http.expectOne('/api/notifications/n1/read').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.unreadCount()).toBe(2);
    expect(service.items()[0].readAt).toBeNull();
  });

  it('marks all as read', () => {
    service.refresh();
    http.expectOne((req) => req.url === '/api/notifications').flush(page([notification('n1'), notification('n2')]));
    service.markAllRead().subscribe();
    http.expectOne('/api/notifications/read-all').flush(null, { status: 204, statusText: 'No Content' });
    expect(service.unreadCount()).toBe(0);
    expect(service.items().every((item) => item.readAt)).toBe(true);
  });

  it('opens the task in its organization from the menu and handles unavailable organizations', async () => {
    const fixture = TestBed.createComponent(NotificationsMenuComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    service.refresh();
    http.expectOne((req) => req.url === '/api/notifications').flush(page([
      notification('n1'), notification('n2', { organizationId: 'gone', organization: { id: 'gone', name: 'Antiga' } }),
    ]));
    await fixture.whenStable();
    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('2');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const [first, second] = Array.from(element.querySelectorAll<HTMLButtonElement>('.item'));
    first.click();
    http.expectOne('/api/notifications/n1/read').flush(null, { status: 204, statusText: 'No Content' });
    expect(select).toHaveBeenCalledWith('two');
    expect(navigate).toHaveBeenCalledWith(['/tasks'], { queryParams: { task: '33333333-3333-4333-8333-333333333333' } });
    second.click();
    http.expectOne('/api/notifications/n2/read').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledOnce();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('não está mais disponível');
    fixture.destroy();
  });
});
