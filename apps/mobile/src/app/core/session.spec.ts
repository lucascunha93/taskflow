import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './api-base-url';
import { authInterceptor } from './auth.interceptor';
import { MemorySecureStore, SecureStore } from './secure-store';
import { SESSION_USER_CHANGED, SessionService } from './session.service';

const user = { id: 'u1', name: 'Ana', email: 'ana@example.test' };
const session = (refreshToken: string, accessToken = `access-${refreshToken}`) => ({
  accessToken, tokenType: 'Bearer', expiresIn: 900, refreshToken, refreshExpiresAt: '2030-01-01T00:00:00Z', user,
});
/** Deixa as promessas pendentes avançarem até a próxima requisição. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SessionService and auth interceptor', () => {
  let store: MemorySecureStore;
  let http: HttpTestingController;
  let changed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new MemorySecureStore();
    changed = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: SecureStore, useValue: store },
        { provide: SESSION_USER_CHANGED, useValue: changed },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('logs in, keeps the refresh token in secure storage and wipes data of another user', async () => {
    store.values.set('taskflow.user', JSON.stringify({ ...user, id: 'previous' }));
    const service = TestBed.inject(SessionService);
    const login = service.login('ana@example.test', 'segredo');
    await settle();
    const request = http.expectOne('/api/auth/mobile/login');
    expect(request.request.body).toEqual({ email: 'ana@example.test', password: 'segredo' });
    request.flush(session('r1'));
    await login;
    expect(changed).toHaveBeenCalledWith('previous');
    expect(store.values.get('taskflow.refreshToken')).toBe('r1');
    expect(service.status()).toBe('online');
    expect(service.user()).toEqual(user);
  });

  it('restores a saved session and shares one refresh between concurrent calls', async () => {
    store.values.set('taskflow.refreshToken', 'r1');
    store.values.set('taskflow.user', JSON.stringify(user));
    const service = TestBed.inject(SessionService);
    const start = service.start();
    const second = service.refresh();
    await settle();
    const request = http.expectOne('/api/auth/mobile/refresh');
    expect(request.request.body).toEqual({ refreshToken: 'r1' });
    request.flush(session('r2'));
    await start;
    expect(await second).toBe('access-r2');
    expect(store.values.get('taskflow.refreshToken')).toBe('r2');
    expect(service.status()).toBe('online');
  });

  it('stays usable offline when the refresh fails for lack of network', async () => {
    store.values.set('taskflow.refreshToken', 'r1');
    store.values.set('taskflow.user', JSON.stringify(user));
    const service = TestBed.inject(SessionService);
    const start = service.start();
    await settle();
    http.expectOne('/api/auth/mobile/refresh').error(new ProgressEvent('error'), { status: 0 });
    await start;
    expect(service.status()).toBe('offline');
    expect(service.signedIn()).toBe(true);
    expect(store.values.get('taskflow.refreshToken')).toBe('r1');
  });

  it('signs out without wiping local data when the session expired', async () => {
    store.values.set('taskflow.refreshToken', 'r1');
    store.values.set('taskflow.user', JSON.stringify(user));
    const service = TestBed.inject(SessionService);
    const start = service.start();
    await settle();
    http.expectOne('/api/auth/mobile/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    await start;
    expect(service.status()).toBe('signed-out');
    expect(store.values.has('taskflow.refreshToken')).toBe(false);
    expect(store.values.get('taskflow.user')).toBeDefined();
    expect(changed).not.toHaveBeenCalled();
  });

  it('adds the bearer token and retries once after renewing on 401', async () => {
    store.values.set('taskflow.refreshToken', 'r1');
    store.values.set('taskflow.user', JSON.stringify(user));
    const service = TestBed.inject(SessionService);
    const client = TestBed.inject(HttpClient);
    const start = service.start();
    await settle();
    http.expectOne('/api/auth/mobile/refresh').flush(session('r2'));
    await start;

    const result = firstValueFrom(client.get('/api/organizations'));
    await settle();
    const first = http.expectOne('/api/organizations');
    expect(first.request.headers.get('Authorization')).toBe('Bearer access-r2');
    first.flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.expectOne('/api/auth/mobile/refresh').flush(session('r3'));
    await settle();
    const retry = http.expectOne('/api/organizations');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-r3');
    retry.flush([]);
    expect(await result).toEqual([]);
  });

  it('asks for a password reset without needing a session', async () => {
    const service = TestBed.inject(SessionService);
    const request = service.requestPasswordReset('ana@example.test');
    await settle();
    const call = http.expectOne('/api/auth/password/forgot');
    expect(call.request.headers.has('Authorization')).toBe(false);
    expect(call.request.body).toEqual({ email: 'ana@example.test' });
    call.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
    await request;
  });

  it('revokes the session and wipes local data on logout, even offline', async () => {
    store.values.set('taskflow.refreshToken', 'r1');
    store.values.set('taskflow.user', JSON.stringify(user));
    const service = TestBed.inject(SessionService);
    const logout = service.logout();
    await settle();
    http.expectOne('/api/auth/mobile/logout').error(new ProgressEvent('error'), { status: 0 });
    await logout;
    expect(changed).toHaveBeenCalled();
    expect(store.values.size).toBe(0);
    expect(service.status()).toBe('signed-out');
  });
});
