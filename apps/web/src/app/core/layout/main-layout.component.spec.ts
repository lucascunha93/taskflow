import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { MainLayoutComponent } from './main-layout.component';

@Component({ template: '<h1>Página de teste</h1>' })
class TestPageComponent {}

describe('MainLayoutComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        provideRouter([{ path: 'test', component: TestPageComponent }]),
        { provide: AuthService, useValue: {
          user: signal({ id: 'user-id', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' }),
          status: signal('authenticated'),
          logout: vi.fn(),
        } },
      ],
    }).compileComponents();
  });

  it('shows the authenticated user and keeps unavailable navigation and search disabled', async () => {
    const fixture = TestBed.createComponent(MainLayoutComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Pessoa Teste');
    expect(element.textContent).toContain('pessoa@example.test');
    expect(element.textContent).toContain('prévia do layout');
    expect(element.querySelector<HTMLAnchorElement>('.skip-link')?.getAttribute('href')).toBe('#main-content');
    const navButtons = element.querySelectorAll<HTMLButtonElement>('nav button');
    expect(Array.from(navButtons, (button) => button.textContent?.trim())).toEqual([
      'Dashboard', 'Minhas tarefas', 'Todas as tarefas', 'Membros', 'Configurações',
    ]);
    expect(Array.from(navButtons).every((button) => button.disabled)).toBe(true);
    expect(element.querySelector<HTMLInputElement>('input[type="search"]')?.disabled).toBe(true);
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
