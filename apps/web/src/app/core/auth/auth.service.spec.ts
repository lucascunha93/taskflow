import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const user = { id: 'id-1', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' };
const credentials = { email: 'pessoa@example.test', password: 'synthetic-password' };
const fakeToken = 'synthetic-token';
const loginResponse = { accessToken: fakeToken, tokenType: 'Bearer', expiresIn: 900, user: { id: user.id, name: user.name, email: user.email } };

describe('AuthService and interceptor', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function login(): Promise<unknown> {
    const result = firstValueFrom(auth.login(credentials));
    const request = http.expectOne('/api/auth/login');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(loginResponse);
    const profile = http.expectOne('/api/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe(`Bearer ${fakeToken}`);
    profile.flush(user);
    return result;
  }

  it('logs in, validates the profile and restores it from storage after reload', async () => {
    await expect(login()).resolves.toEqual(user);
    expect(auth.status()).toBe('authenticated');
    expect(auth.user()).toEqual(user);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    const first = firstValueFrom(auth.restoreSession());
    const second = firstValueFrom(auth.restoreSession());
    expect(auth.status()).toBe('loading');
    const profile = http.expectOne('/api/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe(`Bearer ${fakeToken}`);
    profile.flush(user);
    await expect(first).resolves.toBe('authenticated');
    await expect(second).resolves.toBe('authenticated');
    expect(auth.user()).toEqual(user);
  });

  it('propagates login failures without creating a session', async () => {
    const result = firstValueFrom(auth.login(credentials));
    http.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.user()).toBeNull();
    expect(auth.getToken()).toBeNull();
  });

  it('registers without a token and propagates registration errors', async () => {
    const data = { ...credentials, name: user.name };
    const success = firstValueFrom(auth.register(data));
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual(data);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(user);
    await expect(success).resolves.toEqual(user);
    const failure = firstValueFrom(auth.register(data));
    http.expectOne('/api/auth/register').flush({}, { status: 409, statusText: 'Conflict' });
    await expect(failure).rejects.toMatchObject({ status: 409 });
  });

  it('clears local session on logout', async () => {
    await login();
    auth.logout();
    expect(auth.status()).toBe('unauthenticated');
    expect(auth.user()).toBeNull();
    expect(auth.getToken()).toBeNull();
    expect(sessionStorage.getItem('taskflow.accessToken')).toBeNull();
  });

  it('clears a provisional token if profile validation is cancelled', () => {
    const subscription = auth.login(credentials).subscribe();
    http.expectOne('/api/auth/login').flush(loginResponse);
    const profile = http.expectOne('/api/auth/me');
    subscription.unsubscribe();
    expect(profile.cancelled).toBe(true);
    expect(auth.getToken()).toBeNull();
    expect(auth.status()).toBe('unauthenticated');
    expect(sessionStorage.getItem('taskflow.accessToken')).toBeNull();
  });

  it('does not silently retain a session when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    const result = firstValueFrom(auth.login(credentials));
    http.expectOne('/api/auth/login').flush(loginResponse);
    await expect(result).rejects.toMatchObject({ message: 'Não foi possível armazenar a sessão neste navegador.' });
    expect(auth.user()).toBeNull();
    expect(auth.getToken()).toBeNull();
    http.expectNone('/api/auth/me');
  });

  it('does not restore a logged-out session if storage removal initially fails', async () => {
    await login();
    const removal = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('unavailable'); });
    auth.logout();
    expect(auth.status()).toBe('error');
    removal.mockRestore();
    await expect(firstValueFrom(auth.restoreSession())).resolves.toBe('unauthenticated');
    expect(auth.getToken()).toBeNull();
    http.expectNone('/api/auth/me');
  });

  it('does not send credentials to other origins, paths, or public endpoints', async () => {
    await login();
    const client = TestBed.inject(HttpClient);
    client.get('https://outside.example.test/api/tasks').subscribe();
    client.get('/api-other/tasks').subscribe();
    auth.register({ ...credentials, name: user.name }).subscribe();
    for (const url of ['https://outside.example.test/api/tasks', '/api-other/tasks', '/api/auth/register']) {
      const request = http.expectOne(url);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    }
  });

  it('expires only once on concurrent 401 responses', async () => {
    await login();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const client = TestBed.inject(HttpClient);
    client.get('/api/tasks').subscribe({ error: () => undefined });
    client.get('/api/organizations').subscribe({ error: () => undefined });
    http.expectOne('/api/tasks').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/organizations').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.status()).toBe('unauthenticated');
    expect(auth.sessionExpired()).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('preserves the token on network errors when restoring and allows retry', async () => {
    sessionStorage.setItem('taskflow.accessToken', fakeToken);
    const first = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    await expect(first).resolves.toBe('error');
    expect(auth.user()).toBeNull();
    const retry = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/me').flush(user);
    await expect(retry).resolves.toBe('authenticated');
  });

  it('rejects an expired restored session without showing private content', async () => {
    sessionStorage.setItem('taskflow.accessToken', fakeToken);
    const result = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(result).resolves.toBe('unauthenticated');
    expect(auth.sessionExpired()).toBe(true);
    expect(auth.user()).toBeNull();
  });

  it('refuses to authenticate if the profile response is malformed', async () => {
    sessionStorage.setItem('taskflow.accessToken', fakeToken);
    const result = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/me').flush({ id: 'id-1' });
    await expect(result).resolves.toBe('error');
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('error');
  });

  it('rejects a malformed login response before storing a token', async () => {
    const result = firstValueFrom(auth.login(credentials));
    http.expectOne('/api/auth/login').flush({ tokenType: 'Bearer' });
    await expect(result).rejects.toMatchObject({ message: 'Resposta de autenticação inválida.' });
    expect(auth.getToken()).toBeNull();
    http.expectNone('/api/auth/me');
  });

  it('ignores a stale 401 from a previous session even when the token is identical', async () => {
    await login();
    const client = TestBed.inject(HttpClient);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    client.get('/api/tasks').subscribe({ error: () => undefined });
    auth.logout();
    await login();
    http.expectOne('/api/tasks').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.status()).toBe('authenticated');
    expect(navigate).not.toHaveBeenCalled();
  });
});
