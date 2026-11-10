import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base-url';
import { AuthService } from '../../core/auth/auth.service';
import { ForgotPasswordComponent } from './forgot-password.component';
import { LoginComponent } from './login.component';
import { ResetPasswordComponent, tokenFromFragment } from './reset-password.component';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE';

let controller: HttpTestingController | null = null;

function setup(fragment: string | null = null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: API_BASE_URL, useValue: '/api' },
      { provide: ActivatedRoute, useValue: { snapshot: { fragment, queryParamMap: convertToParamMap({ reset: '1' }) } } },
    ],
  });
  controller = TestBed.inject(HttpTestingController);
  return controller;
}

function type(element: HTMLElement, selector: string, value: string): void {
  const input = element.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Input not found: ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('password recovery', () => {
  afterEach(() => {
    controller?.verify();
    controller = null;
  });

  it('reads the token only from the URL fragment', () => {
    expect(tokenFromFragment(`token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromFragment(null)).toBe('');
    expect(tokenFromFragment('other=1')).toBe('');
  });

  it('asks for a link and shows the same confirmation whether or not the account exists', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    type(element, '#forgot-email', ' ana@example.test ');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne('/api/auth/password/forgot');
    expect(request.request.body).toEqual({ email: 'ana@example.test' });
    request.flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Se houver uma conta com ana@example.test');
  });

  it('explains when recovery is unavailable or rate limited', async () => {
    const http = setup();
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    type(element, '#forgot-email', 'ana@example.test');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/password/forgot').flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('não está disponível');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/password/forgot').flush({}, { status: 429, statusText: 'Too Many Requests' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Muitas tentativas');
  });

  it('sets a new password, clears the token from the address bar and returns to login', async () => {
    const replace = vi.spyOn(history, 'replaceState');
    const http = setup(`token=${TOKEN}`);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    await fixture.whenStable();
    expect(replace).toHaveBeenCalled();
    const element = fixture.nativeElement as HTMLElement;

    type(element, '#reset-password', 'nova-senha-bem-longa');
    type(element, '#reset-confirmation', 'outra-coisa');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(element.textContent).toContain('As senhas não coincidem');
    http.expectNone('/api/auth/password/reset');

    type(element, '#reset-confirmation', 'nova-senha-bem-longa');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne('/api/auth/password/reset');
    expect(request.request.body).toEqual({ token: TOKEN, newPassword: 'nova-senha-bem-longa' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reset: '1' }, replaceUrl: true });
    replace.mockRestore();
  });

  it('offers a new link when the token is invalid or expired', async () => {
    const http = setup(`token=${TOKEN}`);
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    type(element, '#reset-password', 'nova-senha-bem-longa');
    type(element, '#reset-confirmation', 'nova-senha-bem-longa');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/password/reset').flush({}, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('expirou');
    expect(element.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it('asks for a new link when the token is missing', async () => {
    setup(null);
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Link incompleto');
    expect(element.querySelector('form')).toBeNull();
  });

  it('confirms the reset on the login page and links to recovery', async () => {
    setup();
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Senha redefinida');
    expect(element.querySelector('a[href="/forgot-password"]')?.textContent).toContain('Esqueci minha senha');
    expect(TestBed.inject(AuthService).status()).not.toBe('authenticated');
  });
});
