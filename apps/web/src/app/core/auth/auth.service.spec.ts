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
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('AuthService and interceptor', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  function configure(): void {
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
  }

  beforeEach(() => {
    sessionStorage.clear();
    configure();
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
    expect(request.request.withCredentials).toBe(true);
    request.flush(loginResponse);
    const profile = http.expectOne('/api/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe(`Bearer ${fakeToken}`);
    profile.flush(user);
    return result;
  }

  function expectLogoutCall(): void {
    const request = http.expectOne('/api/auth/logout');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-TaskFlow-Request')).toBe('1');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(null, { status: 204, statusText: 'No Content' });
  }

  it('logs in without storing the token and restores the session through the refresh cookie', async () => {
    await expect(login()).resolves.toEqual(user);
    expect(auth.status()).toBe('authenticated');
    expect(sessionStorage.length).toBe(0);
    TestBed.resetTestingModule();
    configure();
    const first = firstValueFrom(auth.restoreSession());
    const second = firstValueFrom(auth.restoreSession());
    expect(auth.status()).toBe('loading');
    http.expectOne('/api/auth/refresh').flush({ ...loginResponse, accessToken: 'restored-token' });
    const profile = http.expectOne('/api/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe('Bearer restored-token');
    profile.flush(user);
    await expect(first).resolves.toBe('authenticated');
    await expect(second).resolves.toBe('authenticated');
    expect(auth.user()).toEqual(user);
  });

  it('removes a token left in sessionStorage by previous versions', () => {
    sessionStorage.setItem('taskflow.accessToken', 'legacy');
    TestBed.resetTestingModule();
    configure();
    expect(sessionStorage.getItem('taskflow.accessToken')).toBeNull();
  });

  it('retries a refresh once after a concurrent-refresh conflict', async () => {
    vi.useFakeTimers();
    try {
      const result = firstValueFrom(auth.restoreSession());
      http.expectOne('/api/auth/refresh').flush({}, { status: 409, statusText: 'Conflict' });
      await vi.advanceTimersByTimeAsync(400);
      http.expectOne('/api/auth/refresh').flush(loginResponse);
      http.expectOne('/api/auth/me').flush(user);
      await expect(result).resolves.toBe('authenticated');
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates login failures without creating a session', async () => {
    const result = firstValueFrom(auth.login(credentials));
    http.expectOne('/api/auth/login').flush({}, unauthorized);
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

  it('clears the local session immediately on logout and asks the API to revoke the cookie session', async () => {
    await login();
    auth.logout();
    expect(auth.status()).toBe('unauthenticated');
    expect(auth.user()).toBeNull();
    expect(auth.getToken()).toBeNull();
    expectLogoutCall();
  });

  it('keeps the local logout when the API cannot be reached', async () => {
    await login();
    auth.logout();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));
    expect(auth.status()).toBe('unauthenticated');
  });

  it('clears a provisional token if profile validation is cancelled', () => {
    const subscription = auth.login(credentials).subscribe();
    http.expectOne('/api/auth/login').flush(loginResponse);
    const profile = http.expectOne('/api/auth/me');
    subscription.unsubscribe();
    expect(profile.cancelled).toBe(true);
    expect(auth.getToken()).toBeNull();
    expect(auth.status()).toBe('unauthenticated');
  });

  it('does not send the bearer token to other origins, paths, or session endpoints', async () => {
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

  it('renews an expired access token once and repeats the original request', async () => {
    await login();
    const client = TestBed.inject(HttpClient);
    const result = firstValueFrom(client.get('/api/organizations'));
    http.expectOne('/api/organizations').flush({}, unauthorized);
    http.expectOne('/api/auth/refresh').flush({ ...loginResponse, accessToken: 'renewed-token' });
    const retried = http.expectOne('/api/organizations');
    expect(retried.request.headers.get('Authorization')).toBe('Bearer renewed-token');
    retried.flush([]);
    await expect(result).resolves.toEqual([]);
    expect(auth.getToken()).toBe('renewed-token');
    expect(auth.status()).toBe('authenticated');
  });

  it('shares one refresh between concurrent 401 responses', async () => {
    await login();
    const client = TestBed.inject(HttpClient);
    const tasks = firstValueFrom(client.get('/api/tasks'));
    const organizations = firstValueFrom(client.get('/api/organizations'));
    http.expectOne('/api/tasks').flush({}, unauthorized);
    http.expectOne('/api/organizations').flush({}, unauthorized);
    http.expectOne('/api/auth/refresh').flush({ ...loginResponse, accessToken: 'renewed-token' });
    http.expectOne('/api/tasks').flush({ ok: 1 });
    http.expectOne('/api/organizations').flush({ ok: 2 });
    await expect(tasks).resolves.toEqual({ ok: 1 });
    await expect(organizations).resolves.toEqual({ ok: 2 });
  });

  it('expires the session only once when the refresh session is no longer valid', async () => {
    await login();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const client = TestBed.inject(HttpClient);
    client.get('/api/tasks').subscribe({ error: () => undefined });
    client.get('/api/organizations').subscribe({ error: () => undefined });
    http.expectOne('/api/tasks').flush({}, unauthorized);
    http.expectOne('/api/organizations').flush({}, unauthorized);
    http.expectOne('/api/auth/refresh').flush({}, unauthorized);
    expect(auth.status()).toBe('unauthenticated');
    expect(auth.sessionExpired()).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('keeps the session when the refresh fails because of the network', async () => {
    await login();
    const client = TestBed.inject(HttpClient);
    const result = firstValueFrom(client.get('/api/tasks'));
    http.expectOne('/api/tasks').flush({}, unauthorized);
    http.expectOne('/api/auth/refresh').flush({}, { status: 503, statusText: 'Unavailable' });
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.status()).toBe('authenticated');
  });

  it('does not refresh again when the repeated request is also rejected', async () => {
    await login();
    const client = TestBed.inject(HttpClient);
    const result = firstValueFrom(client.get('/api/tasks'));
    http.expectOne('/api/tasks').flush({}, unauthorized);
    http.expectOne('/api/auth/refresh').flush({ ...loginResponse, accessToken: 'renewed-token' });
    http.expectOne('/api/tasks').flush({}, unauthorized);
    await expect(result).rejects.toMatchObject({ status: 401 });
    http.expectNone('/api/auth/refresh');
  });

  it('allows retrying a restore after a network error', async () => {
    const first = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/refresh').flush({}, { status: 503, statusText: 'Unavailable' });
    await expect(first).resolves.toBe('error');
    expect(auth.user()).toBeNull();
    const retry = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/refresh').flush(loginResponse);
    http.expectOne('/api/auth/me').flush(user);
    await expect(retry).resolves.toBe('authenticated');
  });

  it('refuses to authenticate if the profile response is malformed', async () => {
    const result = firstValueFrom(auth.restoreSession());
    http.expectOne('/api/auth/refresh').flush(loginResponse);
    http.expectOne('/api/auth/me').flush({ id: 'id-1' });
    await expect(result).resolves.toBe('error');
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('error');
  });

  it('rejects a malformed login response before using a token', async () => {
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
    expectLogoutCall();
    await login();
    http.expectOne('/api/tasks').flush({}, unauthorized);
    // O 401 antigo pede um refresh; a resposta vem para a sessão atual.
    http.expectOne('/api/auth/refresh').flush({}, unauthorized);
    expect(auth.status()).toBe('authenticated');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('updates the authenticated profile name with the bearer token', async () => {
    await login();
    const result = firstValueFrom(auth.updateProfile('Novo Nome'));
    const request = http.expectOne('/api/auth/me');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${fakeToken}`);
    expect(request.request.body).toEqual({ name: 'Novo Nome' });
    request.flush({ ...user, name: 'Novo Nome' });
    await expect(result).resolves.toMatchObject({ name: 'Novo Nome' });
    expect(auth.user()?.name).toBe('Novo Nome');
  });

  it('does not update the profile without a session or after the session changes', async () => {
    await expect(firstValueFrom(auth.updateProfile('Nome'))).rejects.toThrow();
    http.expectNone('/api/auth/me');
    await login();
    const result = firstValueFrom(auth.updateProfile('Nome'));
    const request = http.expectOne('/api/auth/me');
    auth.logout();
    expectLogoutCall();
    request.flush({ ...user, name: 'Nome' });
    await expect(result).rejects.toThrow();
    expect(auth.user()).toBeNull();
  });

  it('changes the password and switches to the returned token without ending the session', async () => {
    await login();
    const result = firstValueFrom(auth.changePassword('old-password-123', 'new-password-123'), { defaultValue: undefined });
    const request = http.expectOne('/api/auth/me/password');
    expect(request.request.method).toBe('PUT');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${fakeToken}`);
    expect(request.request.body).toEqual({ currentPassword: 'old-password-123', newPassword: 'new-password-123' });
    request.flush({ ...loginResponse, accessToken: 'rotated-token' });
    await result;
    expect(auth.getToken()).toBe('rotated-token');
    expect(sessionStorage.length).toBe(0);
    expect(auth.status()).toBe('authenticated');
  });

  it('keeps the current token when the password change fails or returns another user', async () => {
    await login();
    const failed = firstValueFrom(auth.changePassword('wrong-password', 'new-password-123'), { defaultValue: undefined });
    http.expectOne('/api/auth/me/password').flush({}, { status: 403, statusText: 'Forbidden' });
    await expect(failed).rejects.toMatchObject({ status: 403 });
    expect(auth.status()).toBe('authenticated');
    const mismatched = firstValueFrom(auth.changePassword('old-password-123', 'new-password-123'), { defaultValue: undefined });
    http.expectOne('/api/auth/me/password').flush({ ...loginResponse, accessToken: 'other', user: { ...loginResponse.user, id: 'other-id' } });
    await expect(mismatched).rejects.toThrow();
    expect(auth.getToken()).toBe(fakeToken);
  });

  it('revokes all sessions on the API and then clears the local session', async () => {
    await login();
    const result = firstValueFrom(auth.revokeAllSessions(), { defaultValue: undefined });
    const request = http.expectOne('/api/auth/me/sessions');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.withCredentials).toBe(true);
    expect(auth.status()).toBe('authenticated');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await result;
    expect(auth.status()).toBe('unauthenticated');
    expect(auth.getToken()).toBeNull();
  });
});
