import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { MembersPageComponent } from './members-page.component';

const owner: Organization = { id: 'one', name: 'Equipe A', slug: 'a', role: 'OWNER', createdAt: '2026-01-01' };
const active = signal<Organization | null>(owner);
const status = signal<'ready' | 'loading' | 'error'>('ready');
const member = { id: 'm1', role: 'OWNER', createdAt: '2026-01-01', user: { id: 'u1', name: 'Pessoa A', email: 'a@example.test' } };

describe('MembersPageComponent', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    active.set(owner);
    status.set('ready');
    TestBed.configureTestingModule({
      imports: [MembersPageComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: OrganizationsService, useValue: { active, status, refresh: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('shows loading, validates email, prevents duplicate submission and displays success', async () => {
    const fixture = TestBed.createComponent(MembersPageComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Carregando membros');
    http.expectOne('/api/organizations/one/members').flush([member]);
    await fixture.whenStable();
    expect(element.textContent).toContain('Pessoa A');
    expect(element.textContent).toContain('a@example.test');
    expect(element.textContent).toContain('Proprietário');
    const form = element.querySelector('form');
    const input = element.querySelector<HTMLInputElement>('#member-email');
    if (!form || !input) throw new Error('Form not found');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(element.querySelector('#member-email-error')?.textContent).toContain('e-mail válido');
    input.value = 'b@example.test';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(element.textContent).toContain('Adicionando');
    const request = http.expectOne('/api/organizations/one/members');
    request.flush({ user: { id: 'u2', name: 'Pessoa B', email: 'b@example.test' }, membership: { id: 'm2', role: 'MEMBER', createdAt: '2026-01-02' } });
    await fixture.whenStable();
    expect(element.textContent).toContain('Membro adicionado');
    expect(element.textContent).toContain('Pessoa B');
    expect(input.value).toBe('');
    fixture.destroy();
  });

  it('adapts role options and form visibility to the active role', async () => {
    const fixture = TestBed.createComponent(MembersPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/members').flush([member]);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('option')).toHaveLength(2);
    const select = element.querySelector<HTMLSelectElement>('#member-role');
    if (!select) throw new Error('Role selector not found');
    select.value = 'ADMIN';
    select.dispatchEvent(new Event('change'));
    active.set({ ...owner, role: 'ADMIN' });
    await fixture.whenStable();
    expect(element.querySelectorAll('option')).toHaveLength(1);
    expect(select.value).toBe('MEMBER');
    active.set({ ...owner, role: 'MEMBER' });
    await fixture.whenStable();
    expect(element.querySelector('form')).toBeNull();
    expect(element.textContent).toContain('Somente proprietários e administradores');
    fixture.destroy();
  });

  it('shows empty, error and no-organization states without old members', async () => {
    const fixture = TestBed.createComponent(MembersPageComponent);
    await fixture.whenStable();
    http.expectOne('/api/organizations/one/members').flush([]);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Nenhum membro encontrado');
    active.set({ ...owner, id: 'two', name: 'Equipe B' });
    await fixture.whenStable();
    http.expectOne('/api/organizations/two/members').flush({}, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('permissão');
    active.set(null);
    await fixture.whenStable();
    expect(element.textContent).toContain('Selecione ou crie uma organização');
    expect(element.textContent).not.toContain('Pessoa A');
    fixture.destroy();
  });

  it('cancels a pending request when leaving the page', async () => {
    const fixture = TestBed.createComponent(MembersPageComponent);
    await fixture.whenStable();
    const request = http.expectOne('/api/organizations/one/members');
    fixture.destroy();
    expect(request.cancelled).toBe(true);
  });
});
