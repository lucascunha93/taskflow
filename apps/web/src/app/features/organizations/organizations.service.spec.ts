import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { OrganizationsService } from './organizations.service';

const user = { id: 'user-1', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' };
const first = { id: 'org-1', name: 'Equipe A', slug: 'equipe-a', createdAt: '2026-01-01T00:00:00.000Z', memberships: [{ role: 'MEMBER' }] };
const second = { id: 'org-2', name: 'Equipe B', slug: 'equipe-b', createdAt: '2026-01-02T00:00:00.000Z', memberships: [{ role: 'OWNER' }] };
const storageKey = 'taskflow.activeOrganization';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    auth = TestBed.inject(AuthService);
    service = TestBed.inject(OrganizationsService);
    http = TestBed.inject(HttpTestingController);
    const result = firstValueFrom(auth.login({ email: user.email, password: 'synthetic-password' }));
    http.expectOne('/api/auth/login').flush({
      accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 900,
      user: { id: user.id, name: user.name, email: user.email },
    });
    http.expectOne('/api/auth/me').flush(user);
    await result;
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function load(items: object[]): void {
    service.load();
    const request = http.expectOne('/api/organizations');
    expect(request.request.headers.has('Authorization')).toBe(true);
    request.flush(items);
  }

  it('lists and normalizes memberships without choosing between multiple organizations', () => {
    load([first, second]);
    expect(service.status()).toBe('ready');
    expect(service.organizations()).toEqual([
      { id: first.id, name: first.name, slug: first.slug, createdAt: first.createdAt, role: 'MEMBER' },
      { id: second.id, name: second.name, slug: second.slug, createdAt: second.createdAt, role: 'OWNER' },
    ]);
    expect(service.active()).toBeNull();
    service.load();
    http.expectNone('/api/organizations');
  });

  it('handles an empty list and selects a sole available organization', () => {
    load([]);
    expect(service.organizations()).toEqual([]);
    expect(service.active()).toBeNull();
    service.refresh();
    http.expectOne('/api/organizations').flush([first]);
    expect(service.active()?.id).toBe(first.id);
  });

  it('selects and switches only to available organizations and restores the saved selection', () => {
    load([first, second]);
    expect(service.select('unknown')).toBe(false);
    expect(service.active()).toBeNull();
    expect(service.select(first.id)).toBe(true);
    expect(service.select(second.id)).toBe(true);
    expect(service.active()?.id).toBe(second.id);
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).toEqual({ userId: user.id, organizationId: second.id });
    service.refresh();
    expect(service.active()).toBeNull();
    http.expectOne('/api/organizations').flush([first, second]);
    expect(service.active()?.id).toBe(second.id);
  });

  it('restores a selection after a new application session validates the user', async () => {
    load([first, second]);
    service.select(second.id);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    auth = TestBed.inject(AuthService);
    service = TestBed.inject(OrganizationsService);
    http = TestBed.inject(HttpTestingController);
    const restored = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/me').flush(user);
    await restored;
    load([first, second]);
    expect(service.active()?.id).toBe(second.id);
  });

  it('removes a selection when the organization is no longer available', () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ userId: user.id, organizationId: 'removed' }));
    load([first, second]);
    expect(service.active()).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('does not restore a saved selection belonging to another user', () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ userId: 'other-user', organizationId: second.id }));
    load([first, second]);
    expect(service.active()).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('creates an organization, updates the list and selects the returned organization', async () => {
    load([first]);
    const result = firstValueFrom(service.create('Equipe nova'));
    const request = http.expectOne('/api/organizations');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Equipe nova' });
    const created = { id: 'org-3', name: 'Equipe nova', slug: 'equipe-nova', createdAt: first.createdAt, role: 'OWNER' };
    request.flush(created, { status: 201, statusText: 'Created' });
    await expect(result).resolves.toEqual(created);
    expect(service.organizations().map((item) => item.id)).toEqual(['org-3', first.id]);
    expect(service.active()).toEqual(created);
  });

  it('refreshes again after creation completes during an earlier refresh', async () => {
    load([first]);
    const result = firstValueFrom(service.create('Equipe nova'));
    const creation = http.expectOne('/api/organizations');
    service.refresh();
    const obsoleteRefresh = http.expectOne('/api/organizations');
    const created = { id: 'org-3', name: 'Equipe nova', slug: 'equipe-nova', createdAt: first.createdAt, role: 'OWNER' };
    creation.flush(created);
    await result;
    expect(obsoleteRefresh.cancelled).toBe(true);
    expect(service.status()).toBe('loading');
    http.expectOne('/api/organizations').flush([second, { ...created, memberships: [{ role: created.role }] }]);
    expect(service.organizations().map((item) => item.id)).toEqual([second.id, created.id]);
    expect(service.active()?.id).toBe(created.id);
  });

  it('handles failed requests without reporting an empty successful list', async () => {
    service.load();
    http.expectOne('/api/organizations').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.status()).toBe('error');
    expect(service.active()).toBeNull();
    service.refresh();
    http.expectOne('/api/organizations').flush([]);
    const result = firstValueFrom(service.create('Equipe nova'));
    http.expectOne('/api/organizations').flush({}, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
    expect(service.organizations()).toEqual([]);
    expect(service.active()).toBeNull();
  });

  it('clears state and storage synchronously on logout and cancels in-flight loads', () => {
    load([first]);
    service.refresh();
    const request = http.expectOne('/api/organizations');
    auth.logout();
    expect(request.cancelled).toBe(true);
    expect(service.status()).toBe('idle');
    expect(service.organizations()).toEqual([]);
    expect(service.active()).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('clears the organization on an expired session', () => {
    load([first]);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    service.refresh();
    http.expectOne('/api/organizations').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.status()).toBe('unauthenticated');
    expect(service.active()).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('ignores a late creation response after logout', async () => {
    load([]);
    const result = firstValueFrom(service.create('Equipe nova'));
    const request = http.expectOne('/api/organizations');
    auth.logout();
    request.flush({ id: 'org-3', name: 'Equipe nova', slug: 'equipe-nova', createdAt: first.createdAt, role: 'OWNER' });
    await expect(result).rejects.toThrow('A sessão mudou');
    expect(service.organizations()).toEqual([]);
    expect(service.active()).toBeNull();
  });

  it('reports storage failure while keeping selection only in memory', () => {
    load([first, second]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(service.select(first.id)).toBe(true);
    expect(service.active()?.id).toBe(first.id);
    expect(service.warning()).toContain('Não foi possível salvar');
  });

  it('does not restore a selection after removal failed during logout', async () => {
    load([first, second]);
    service.select(first.id);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key) => {
      if (key === storageKey) throw new Error('unavailable');
    });
    auth.logout();
    expect(service.warning()).toContain('Não foi possível limpar');
    remove.mockRestore();
    const login = firstValueFrom(auth.login({ email: user.email, password: 'synthetic-password' }));
    http.expectOne('/api/auth/login').flush({
      accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 900,
      user: { id: user.id, name: user.name, email: user.email },
    });
    http.expectOne('/api/auth/me').flush(user);
    await login;
    load([first, second]);
    expect(service.active()).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('rejects malformed list responses', () => {
    load([{ ...first, memberships: [] }]);
    expect(service.status()).toBe('error');
    expect(service.active()).toBeNull();
  });
});
