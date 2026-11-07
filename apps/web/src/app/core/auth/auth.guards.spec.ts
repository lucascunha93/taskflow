import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { authGuard, guestGuard, sessionErrorGuard } from './auth.guards';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const user = { id: 'id-1', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' };
const session = { accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 900, user: { id: user.id, name: user.name, email: user.email } };

describe('Session guards', () => {
  let http: HttpTestingController;

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(configure);
  afterEach(() => http.verify());

  function invoke(guard: typeof authGuard) {
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    if (!isObservable(result)) throw new Error('Expected observable guard');
    return firstValueFrom(result);
  }

  it('redirects to login when there is no refresh session and allows the login route', async () => {
    const privateResult = invoke(authGuard);
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect((await privateResult).toString()).toBe('/login');
    expect(await invoke(guestGuard)).toBe(true);
    http.expectNone('/api/auth/me');
    expect(TestBed.inject(AuthService).sessionExpired()).toBe(false);
  });

  it('restores the session with one refresh before allowing private access or redirecting guests', async () => {
    let completed = false;
    const privateResult = invoke(authGuard).then((value) => { completed = true; return value; });
    const guestResult = invoke(guestGuard);
    const refresh = http.expectOne('/api/auth/refresh');
    expect(refresh.request.withCredentials).toBe(true);
    expect(refresh.request.headers.get('X-TaskFlow-Request')).toBe('1');
    expect(refresh.request.headers.has('Authorization')).toBe(false);
    refresh.flush(session);
    expect(completed).toBe(false);
    expect(TestBed.inject(AuthService).user()).toBeNull();
    const profile = http.expectOne('/api/auth/me');
    expect(profile.request.headers.get('Authorization')).toBe('Bearer synthetic-token');
    profile.flush(user);
    expect(await privateResult).toBe(true);
    expect((await guestResult).toString()).toBe('/');
  });

  it('redirects network failures to the session error route rather than treating them as logout', async () => {
    const result = invoke(authGuard);
    http.expectOne('/api/auth/refresh').flush({}, { status: 503, statusText: 'Unavailable' });
    const tree = await result;
    expect(TestBed.inject(Router).serializeUrl(tree as UrlTree)).toBe('/session-error');
    expect(TestBed.inject(AuthService).status()).toBe('error');
  });

  it('only allows the session error page when validation has failed', async () => {
    const first = invoke(sessionErrorGuard);
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect((await first).toString()).toBe('/login');
    TestBed.resetTestingModule();
    configure();
    const result = invoke(authGuard);
    http.expectOne('/api/auth/refresh').flush({}, { status: 503, statusText: 'Unavailable' });
    expect((await result).toString()).toBe('/session-error');
    expect(TestBed.runInInjectionContext(() =>
      sessionErrorGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    )).toBe(true);
    http.expectNone('/api/auth/refresh');
  });
});
