import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { Organization } from './organization.models';
import { OrganizationsService } from './organizations.service';
import { OrganizationHomeComponent } from './organization-home.component';
import { OrganizationSelectorComponent } from './organization-selector.component';
import { CreateOrganizationComponent } from './create-organization.component';

const first: Organization = { id: 'one', name: 'Equipe A', slug: 'equipe-a', role: 'OWNER', createdAt: '2026-01-01' };
const second: Organization = { id: 'two', name: 'Equipe B', slug: 'equipe-b', role: 'MEMBER', createdAt: '2026-01-01' };

describe('Organization components', () => {
  const active = signal<Organization | null>(null);
  const items = signal<Organization[]>([]);
  const status = signal<'loading' | 'ready' | 'error'>('ready');
  const warning = signal('');
  let created: Subject<Organization>;
  const service = {
    active, organizations: items, status, warning,
    load: vi.fn(), refresh: vi.fn(), select: vi.fn((id: string) => {
      const match = items().find((item) => item.id === id);
      if (!match) return false;
      active.set(match);
      return true;
    }),
    create: vi.fn(() => created.asObservable()),
  };

  beforeEach(() => {
    active.set(null);
    items.set([]);
    status.set('ready');
    warning.set('');
    created = new Subject<Organization>();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [OrganizationHomeComponent, OrganizationSelectorComponent, CreateOrganizationComponent],
      providers: [
        provideRouter([]),
        { provide: OrganizationsService, useValue: service },
      ],
    });
  });

  it('shows loading, failure, empty and choice states on the home page', async () => {
    const fixture = TestBed.createComponent(OrganizationHomeComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Crie sua primeira organização');
    status.set('loading');
    await fixture.whenStable();
    expect(element.textContent).toContain('Carregando organizações');
    status.set('error');
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar');
    status.set('ready');
    items.set([first, second]);
    await fixture.whenStable();
    expect(element.textContent).toContain('Escolha uma organização');
    element.querySelector<HTMLButtonElement>('.organization-choice')?.click();
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toBe(first.name);
  });

  it('opens the selector, switches organization and closes after selection', async () => {
    items.set([first, second]);
    active.set(first);
    const fixture = TestBed.createComponent(OrganizationSelectorComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const details = element.querySelector('details');
    if (!details) throw new Error('Selector not found');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await fixture.whenStable();
    const buttons = element.querySelectorAll<HTMLButtonElement>('li button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    buttons[1].click();
    await fixture.whenStable();
    expect(active()).toEqual(second);
    expect(details.open).toBe(false);
    expect(element.querySelector('summary')?.textContent).toContain(second.name);
  });

  it('closes the selector on Escape and returns focus to its summary', async () => {
    const fixture = TestBed.createComponent(OrganizationSelectorComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const details = element.querySelector('details');
    const summary = element.querySelector('summary');
    if (!details || !summary) throw new Error('Selector not found');
    const focus = vi.spyOn(summary, 'focus');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await fixture.whenStable();
    details.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(details.open).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('validates creation and exposes loading and errors', async () => {
    const fixture = TestBed.createComponent(CreateOrganizationComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const form = element.querySelector('form');
    const input = element.querySelector<HTMLInputElement>('#organization-name');
    if (!form || !input) throw new Error('Form not found');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(element.textContent).toContain('Informe um nome com 2 a 120 caracteres');
    expect(service.create).not.toHaveBeenCalled();
    input.value = '  Equipe A  ';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(service.create).toHaveBeenCalledWith('Equipe A');
    expect(element.textContent).toContain('Criando…');
    created.error(new HttpErrorResponse({ status: 409 }));
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('conflito');
  });

  it('shows creation feedback when returning to the home page', async () => {
    active.set(first);
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '', component: OrganizationHomeComponent }]);
    const harness = await RouterTestingHarness.create();
    await router.navigate(['/'], { info: { createdOrganizationId: first.id } });
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Organização criada e selecionada com sucesso');
    active.set(second);
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).not.toContain('Organização criada e selecionada com sucesso');
  });

  it('navigates with transient feedback after creation', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CreateOrganizationComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('#organization-name');
    const form = element.querySelector('form');
    if (!input || !form) throw new Error('Form not found');
    input.value = 'Equipe A';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    created.next(first);
    created.complete();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith(['/'], { info: { createdOrganizationId: first.id } });
  });
});
