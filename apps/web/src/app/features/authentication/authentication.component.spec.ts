import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base-url';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { LoginComponent } from './login.component';
import { RegisterComponent } from './register.component';

const user = { id: 'id-1', name: 'Pessoa Teste', email: 'pessoa@example.test', createdAt: '2026-01-01T00:00:00.000Z' };

describe('Authentication forms', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginComponent, RegisterComponent],
      providers: [
        provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function input(element: HTMLElement, selector: string, value: string): void {
    const field = element.querySelector<HTMLInputElement>(selector);
    if (!field) throw new Error(`Missing input ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  function submit(fixture: ComponentFixture<LoginComponent | RegisterComponent>): void {
    const form = (fixture.nativeElement as HTMLElement).querySelector('form');
    if (!form) throw new Error('Missing form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('validates login fields and displays loading and authentication errors', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    submit(fixture);
    expect(element.textContent).toContain('Informe um e-mail válido');
    expect(element.textContent).toContain('Informe sua senha');
    http.expectNone('/api/auth/login');
    input(element, '#login-email', user.email);
    input(element, '#login-password', 'synthetic-password');
    submit(fixture);
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(element.textContent).toContain('Entrando');
    http.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('E-mail ou senha inválidos');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('validates the profile after login before navigating', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    input(element, '#login-email', user.email);
    input(element, '#login-password', 'synthetic-password');
    submit(fixture);
    http.expectOne('/api/auth/login').flush({
      accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 900,
      user: { id: user.id, name: user.name, email: user.email },
    });
    expect(navigate).not.toHaveBeenCalled();
    http.expectOne('/api/auth/me').flush(user);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(TestBed.inject(AuthService).user()).toEqual(user);
  });

  it('validates registration and password confirmation before making a request', () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    input(element, '#register-name', '  ');
    input(element, '#register-email', user.email);
    input(element, '#register-password', 'synthetic-password');
    input(element, '#register-confirmation', 'different-password');
    submit(fixture);
    expect(element.textContent).toContain('Informe um nome');
    expect(element.textContent).toContain('As senhas devem ser iguais');
    http.expectNone('/api/auth/register');
  });

  it('rejects invalid email and passwords shorter than the backend minimum', () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    input(element, '#register-name', user.name);
    input(element, '#register-email', 'invalid');
    input(element, '#register-password', 'short');
    input(element, '#register-confirmation', 'short');
    submit(fixture);
    expect(element.textContent).toContain('Informe um e-mail válido');
    expect(element.textContent).toContain('A senha deve ter de 12 a 128 caracteres');
    http.expectNone('/api/auth/register');
  });

  it('shows registration loading and conflict errors', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    input(element, '#register-name', ' Pessoa Teste ');
    input(element, '#register-email', user.email);
    input(element, '#register-password', 'synthetic-password');
    input(element, '#register-confirmation', 'synthetic-password');
    submit(fixture);
    expect(element.textContent).toContain('Criando conta');
    const request = http.expectOne('/api/auth/register');
    expect(request.request.body).toEqual({ name: 'Pessoa Teste', email: user.email, password: 'synthetic-password' });
    request.flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('já está cadastrado');
  });

  it('redirects to login after registration without creating a session', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    input(element, '#register-name', user.name);
    input(element, '#register-email', user.email);
    input(element, '#register-password', 'synthetic-password');
    input(element, '#register-confirmation', 'synthetic-password');
    submit(fixture);
    http.expectOne('/api/auth/register').flush(user);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { registered: '1' } });
    expect(TestBed.inject(AuthService).user()).toBeNull();
    http.expectNone('/api/auth/me');
  });

  it('displays a generic error if login profile verification fails', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    input(element, '#login-email', user.email);
    input(element, '#login-password', 'synthetic-password');
    submit(fixture);
    http.expectOne('/api/auth/login').flush({
      accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 900,
      user: { id: user.id, name: user.name, email: user.email },
    });
    http.expectOne('/api/auth/me').flush({ message: 'internal detail' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível entrar');
    expect(element.textContent).not.toContain('internal detail');
    expect(TestBed.inject(AuthService).getToken()).toBeNull();
  });
});
