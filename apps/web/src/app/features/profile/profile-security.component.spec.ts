import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ChangePasswordComponent } from './change-password.component';
import { EndSessionsComponent } from './end-sessions.component';

describe('Profile security components', () => {
  let changed: Subject<void>;
  let revoked: Subject<void>;
  const status = signal<'authenticated' | 'unauthenticated' | 'error'>('authenticated');
  const auth = {
    status,
    changePassword: vi.fn(() => changed.asObservable()),
    revokeAllSessions: vi.fn(() => revoked.asObservable()),
  };

  beforeEach(() => {
    changed = new Subject<void>();
    revoked = new Subject<void>();
    status.set('authenticated');
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [ChangePasswordComponent, EndSessionsComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  function type(element: HTMLElement, id: string, value: string): void {
    const field = element.querySelector<HTMLInputElement>(`#${id}`);
    if (!field) throw new Error(`Field not found: ${id}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  describe('ChangePasswordComponent', () => {
    let fixture: ComponentFixture<ChangePasswordComponent>;
    let element: HTMLElement;

    beforeEach(async () => {
      fixture = TestBed.createComponent(ChangePasswordComponent);
      await fixture.whenStable();
      element = fixture.nativeElement as HTMLElement;
    });

    function submit(): void {
      element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    }
    function fill(current: string, next: string, confirmation = next): void {
      type(element, 'current-password', current);
      type(element, 'new-password', next);
      type(element, 'new-password-confirmation', confirmation);
    }

    it('validates length, confirmation and reuse before calling the API', async () => {
      submit();
      await fixture.whenStable();
      expect(element.textContent).toContain('Informe sua senha atual');
      fill('current-password-1', 'short', 'other');
      submit();
      await fixture.whenStable();
      expect(element.textContent).toContain('de 12 a 128 caracteres');
      expect(element.textContent).toContain('As senhas não coincidem');
      fill('same-password-123', 'same-password-123');
      submit();
      await fixture.whenStable();
      expect(element.textContent).toContain('diferente da atual');
      expect(auth.changePassword).not.toHaveBeenCalled();
    });

    it('changes the password once, clears the form and confirms', async () => {
      fill('current-password-1', 'brand-new-password');
      submit();
      submit();
      expect(auth.changePassword).toHaveBeenCalledOnce();
      expect(auth.changePassword).toHaveBeenCalledWith('current-password-1', 'brand-new-password');
      changed.next();
      changed.complete();
      await fixture.whenStable();
      expect(element.textContent).toContain('Senha alterada');
      expect(element.querySelector<HTMLInputElement>('#current-password')?.value).toBe('');
    });

    it.each([
      [403, 'senha atual está incorreta'],
      [429, 'Muitas tentativas'],
      [0, 'Se ela tiver sido aplicada'],
    ])('maps a %s response to a clear message', async (code, message) => {
      fill('current-password-1', 'brand-new-password');
      submit();
      changed.error(new HttpErrorResponse({ status: code }));
      await fixture.whenStable();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain(message);
      expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    });
  });

  describe('EndSessionsComponent', () => {
    let fixture: ComponentFixture<EndSessionsComponent>;
    let element: HTMLElement;

    beforeEach(async () => {
      fixture = TestBed.createComponent(EndSessionsComponent);
      await fixture.whenStable();
      element = fixture.nativeElement as HTMLElement;
    });

    function button(text: string): HTMLButtonElement {
      const result = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
      if (!result) throw new Error(`Button not found: ${text}`);
      return result;
    }

    it('asks for confirmation and can be cancelled without calling the API', async () => {
      button('Encerrar todas as sessões…').click();
      await fixture.whenStable();
      expect(element.textContent).toContain('Encerrar todas as sessões agora?');
      button('Cancelar').click();
      await fixture.whenStable();
      expect(auth.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('revokes all sessions and opens the login with a notice', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      button('Encerrar todas as sessões…').click();
      await fixture.whenStable();
      button('Encerrar todas as sessões').click();
      expect(auth.revokeAllSessions).toHaveBeenCalledOnce();
      status.set('unauthenticated');
      revoked.next();
      revoked.complete();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledWith('/login?sessions=ended');
    });

    it('reports network failures and keeps the user on the page', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      button('Encerrar todas as sessões…').click();
      await fixture.whenStable();
      button('Encerrar todas as sessões').click();
      revoked.error(new HttpErrorResponse({ status: 0 }));
      await fixture.whenStable();
      expect(element.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível encerrar');
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
