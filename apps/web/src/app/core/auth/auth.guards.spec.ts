import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { authGuard, guestGuard, sessionErrorGuard } from './auth.guards';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const user = { id: 'id-1', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' };

describe('Session guards', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  function invoke(guard: typeof authGuard) {
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    if (!isObservable(result)) throw new Error('Expected observable guard');
    return firstValueFrom(result);
  }

  it('redirects an unauthenticated user from a private route and allows the login route', async () => {
    expect((await invoke(authGuard)).toString()).toBe('/login');
    expect(await invoke(guestGuard)).toBe(true);
    http.expectNone('/api/auth/me');
  });

  it('waits for profile validation before allowing private access or redirecting guests', async () => {
    sessionStorage.setItem('taskflow.accessToken', 'synthetic-token');
    let completed = false;
    const privateResult = invoke(authGuard).then((value) => { completed = true; return value; });
    const guestResult = invoke(guestGuard);
    expect(completed).toBe(false);
    expect(TestBed.inject(AuthService).user()).toBeNull();
    http.expectOne('/api/auth/me').flush(user);
    expect(await privateResult).toBe(true);
    expect((await guestResult).toString()).toBe('/');
  });

  it('redirects network failures to the session error route rather than treating them as logout', async () => {
    sessionStorage.setItem('taskflow.accessToken', 'synthetic-token');
    const result = invoke(authGuard);
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    const tree = await result;
    expect(TestBed.inject(Router).serializeUrl(tree as import('@angular/router').UrlTree)).toBe('/session-error');
    expect(TestBed.inject(AuthService).status()).toBe('error');
  });

  it('redirects an expired session to login', async () => {
    sessionStorage.setItem('taskflow.accessToken', 'synthetic-token');
    const result = invoke(authGuard);
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect((await result).toString()).toBe('/login');
    expect(TestBed.inject(AuthService).sessionExpired()).toBe(true);
  });

  it('only allows the session error page when validation has failed', async () => {
    expect((await invoke(sessionErrorGuard)).toString()).toBe('/login');
    sessionStorage.setItem('taskflow.accessToken', 'synthetic-token');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const result = invoke(authGuard);
    http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Unavailable' });
    expect((await result).toString()).toBe('/session-error');
    expect(TestBed.runInInjectionContext(() =>
      sessionErrorGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    )).toBe(true);
    http.expectNone('/api/auth/me');
  });
});
