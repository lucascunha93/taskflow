import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api-base-url';
import { Organization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { MembersService } from './members.service';

const owner: Organization = { id: 'one', name: 'Equipe A', slug: 'a', role: 'OWNER', createdAt: '2026-01-01' };
const member = { id: 'membership-1', role: 'OWNER' as const, createdAt: '2026-01-01', user: { id: 'user-1', name: 'Pessoa A', email: 'a@example.test' } };
const added = { membership: { id: 'membership-2', role: 'MEMBER' as const, createdAt: '2026-01-02' }, user: { id: 'user-2', name: 'Pessoa B', email: 'b@example.test' } };

describe('MembersService', () => {
  const active = signal<Organization | null>(owner);
  let service: MembersService;
  let http: HttpTestingController;

  beforeEach(() => {
    active.set(owner);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(), MembersService,
      { provide: API_BASE_URL, useValue: '/api' },
      { provide: OrganizationsService, useValue: { active } },
    ] });
    service = TestBed.inject(MembersService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
  });

  afterEach(() => http.verify());

  function finishLoad(): void {
    http.expectOne('/api/organizations/one/members').flush([member]);
  }

  it('loads members and displays an empty list when returned', () => {
    expect(service.status()).toBe('loading');
    const request = http.expectOne('/api/organizations/one/members');
    expect(request.request.method).toBe('GET');
    request.flush([]);
    expect(service.status()).toBe('ready');
    expect(service.members()).toEqual([]);
    service.refresh();
    TestBed.tick();
    finishLoad();
    expect(service.members()).toEqual([member]);
  });

  it.each(['MEMBER', 'ADMIN'] as const)('allows OWNER to add %s and updates the list', (role) => {
    finishLoad();
    service.add('b@example.test', role);
    service.add('b@example.test', role);
    const request = http.expectOne('/api/organizations/one/members');
    expect(request.request.body).toEqual({ email: 'b@example.test', role });
    expect(service.adding()).toBe(true);
    request.flush({ ...added, membership: { ...added.membership, role } });
    expect(service.adding()).toBe(false);
    expect(service.members()).toEqual([member, { ...added.membership, role, user: added.user }]);
    expect(service.success()).toContain('adicionado');
  });

  it('allows ADMIN to add MEMBER but not ADMIN', () => {
    active.set({ ...owner, role: 'ADMIN' });
    TestBed.tick();
    finishLoad();
    service.add('b@example.test', 'ADMIN');
    http.expectNone('/api/organizations/one/members');
    expect(service.addError()).toContain('permissão');
    service.add('b@example.test', 'MEMBER');
    const request = http.expectOne('/api/organizations/one/members');
    expect(request.request.body.role).toBe('MEMBER');
    request.flush(added);
  });

  it('does not send additions for MEMBER', () => {
    active.set({ ...owner, role: 'MEMBER' });
    TestBed.tick();
    finishLoad();
    service.add('b@example.test', 'MEMBER');
    http.expectNone('/api/organizations/one/members');
    expect(service.addError()).toContain('permissão');
  });

  it.each([
    [403, 'permissão'],
    [404, 'Usuário não encontrado ou organização indisponível'],
    [409, 'já pertence'],
    [503, 'Não foi possível confirmar'],
  ])('reports POST error %s without changing the list', (code, message) => {
    finishLoad();
    service.add('b@example.test', 'MEMBER');
    http.expectOne('/api/organizations/one/members').flush({}, { status: code, statusText: 'Error' });
    expect(service.addError()).toContain(message);
    expect(service.members()).toEqual([member]);
    expect(service.adding()).toBe(false);
  });

  it('reports list failures and allows retry', () => {
    http.expectOne('/api/organizations/one/members').flush({}, { status: 404, statusText: 'Not Found' });
    expect(service.status()).toBe('error');
    expect(service.loadError()).toContain('Organização não encontrada');
    service.refresh();
    TestBed.tick();
    finishLoad();
    expect(service.status()).toBe('ready');
  });

  it('rejects invalid API responses instead of presenting success', () => {
    http.expectOne('/api/organizations/one/members').flush([{ id: 'invalid' }]);
    expect(service.status()).toBe('error');
    service.refresh();
    TestBed.tick();
    finishLoad();
    service.add('b@example.test', 'MEMBER');
    http.expectOne('/api/organizations/one/members').flush({ membership: {}, user: {} });
    expect(service.addError()).toContain('Não foi possível confirmar');
    expect(service.members()).toEqual([member]);
  });

  it('hides old data immediately and cancels requests when context changes', () => {
    finishLoad();
    service.add('b@example.test', 'MEMBER');
    const pending = http.expectOne('/api/organizations/one/members');
    active.set({ ...owner, id: 'two' });
    expect(service.members()).toEqual([]);
    expect(service.success()).toBe('');
    TestBed.tick();
    expect(pending.cancelled).toBe(true);
    const load = http.expectOne('/api/organizations/two/members');
    active.set(null);
    expect(service.members()).toEqual([]);
    TestBed.tick();
    expect(load.cancelled).toBe(true);
    expect(service.status()).toBe('idle');
  });
});
