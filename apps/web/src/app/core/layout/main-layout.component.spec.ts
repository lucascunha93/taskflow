import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { MainLayoutComponent } from './main-layout.component';
import { OrganizationsService } from '../../features/organizations/organizations.service';
import { NotificationsService } from '../../features/notifications/notifications.service';

@Component({ template: '<h1>Página de teste</h1>' })
class TestPageComponent {}

describe('MainLayoutComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        provideRouter([{ path: 'test', component: TestPageComponent }, { path: 'tasks', component: TestPageComponent }]),
        { provide: AuthService, useValue: {
          user: signal({ id: 'user-id', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' }),
          status: signal('authenticated'),
          logout: vi.fn(),
        } },
        { provide: NotificationsService, useValue: {
          start: vi.fn(), stop: vi.fn(), refresh: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(),
          items: signal([]), unreadCount: signal(0), status: signal('ready'),
        } },
        { provide: OrganizationsService, useValue: {
          load: vi.fn(), refresh: vi.fn(), select: vi.fn(),
          active: signal(null), status: signal('ready'), organizations: signal([]), warning: signal(''),
        } },
      ],
    }).compileComponents();
  });

  it('shows the authenticated user and links every navigation item to a real page', async () => {
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Pessoa Teste');
    expect(element.textContent).toContain('pessoa@example.test');
    expect(element.textContent).not.toContain('prévia do layout');
    expect(element.querySelector<HTMLAnchorElement>('.skip-link')?.getAttribute('href')).toBe('#main-content');
    expect(element.querySelectorAll('nav button')).toHaveLength(0);
    expect(Array.from(element.querySelectorAll<HTMLAnchorElement>('nav a'), (link) => link.getAttribute('href')))
      .toEqual(['/', '/tasks?assignee=me', '/tasks', '/members', '/settings']);
  });

  it('marks only the matching task link as active', async () => {
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await TestBed.inject(Router).navigateByUrl('/tasks?assignee=me');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const current = Array.from(element.querySelectorAll<HTMLAnchorElement>('nav a[aria-current="page"]'));
    expect(current.map((link) => link.textContent?.trim())).toEqual(['Minhas tarefas']);
  });

  it('submits the header search to the task list and clears the field', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const field = element.querySelector<HTMLInputElement>('input[type="search"]');
    if (!field) throw new Error('Search field not found');
    expect(field.disabled).toBe(false);
    field.value = '  relatório  ';
    field.dispatchEvent(new Event('input'));
    field.form?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(navigate).toHaveBeenCalledWith(['/tasks'], { queryParams: { search: 'relatório' } });
    await fixture.whenStable();
    expect(field.value).toBe('');
  });

  it('toggles mobile navigation and closes it with Escape, returning focus', async () => {
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector<HTMLButtonElement>('[aria-controls="primary-sidebar"]');
    const sidebar = element.querySelector<HTMLElement>('#primary-sidebar');
    if (!button) throw new Error('Menu button not found');
    const focus = vi.spyOn(button, 'focus');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar?.classList.contains('sidebar--open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar?.classList.contains('sidebar--open')).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('shows routed content in the layout instead of the introductory placeholder', async () => {
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/test');
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('main h1')?.textContent).toBe('Página de teste');
    expect(element.textContent).not.toContain('prévia do layout');
  });

  it('logs out from the user menu and navigates to login', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.logout');
    if (!button) throw new Error('Logout button not found');
    button.click();
    expect(TestBed.inject(AuthService).logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
