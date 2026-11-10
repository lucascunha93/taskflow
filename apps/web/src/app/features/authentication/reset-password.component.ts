import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AuthShellComponent } from './auth-shell.component';
import { matchingPasswords } from './auth-form.validators';
import { PasswordResetService } from './password-reset.service';

/** Lê o token do fragmento `#token=...`, que o navegador não envia ao servidor. */
export function tokenFromFragment(fragment: string | null): string {
  return new URLSearchParams(fragment ?? '').get('token') ?? '';
}

@Component({
  selector: 'app-reset-password',
  imports: [AuthShellComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-shell>
      <p class="eyebrow">Recuperar acesso</p>
      <h1>Crie uma nova senha</h1>
      @if (!token) {
        <p class="message" role="alert">Link incompleto. Abra o link do e-mail novamente ou peça uma nova redefinição.</p>
        <p class="switch"><a routerLink="/forgot-password">Pedir novo link</a></p>
      } @else {
        <p class="intro">Ao salvar, todas as sessões abertas da sua conta serão encerradas.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="loading()">
          @if (error()) {
            <p class="message" role="alert">{{ error() }}</p>
            @if (expired()) { <p class="switch"><a routerLink="/forgot-password">Pedir novo link</a></p> }
          }
          <div class="field">
            <label for="reset-password">Nova senha</label>
            <input id="reset-password" class="tf-field" type="password" formControlName="password" autocomplete="new-password"
              aria-describedby="reset-password-hint"
              [attr.aria-invalid]="form.controls.password.touched && form.controls.password.invalid" />
            <p id="reset-password-hint" class="hint">De 12 a 128 caracteres.</p>
          </div>
          <div class="field">
            <label for="reset-confirmation">Confirme a nova senha</label>
            <input id="reset-confirmation" class="tf-field" type="password" formControlName="confirmation" autocomplete="new-password"
              [attr.aria-invalid]="form.controls.confirmation.touched && form.hasError('passwordMismatch')"
              [attr.aria-describedby]="form.controls.confirmation.touched && form.hasError('passwordMismatch') ? 'reset-confirmation-error' : null" />
            @if (form.controls.confirmation.touched && form.hasError('passwordMismatch')) {
              <p id="reset-confirmation-error" class="field-error">As senhas não coincidem.</p>
            }
          </div>
          <button class="tf-button submit" type="submit" [disabled]="loading()">
            {{ loading() ? 'Salvando…' : 'Salvar nova senha' }}
          </button>
        </form>
      }
    </app-auth-shell>
  `,
})
export class ResetPasswordComponent {
  private readonly api = inject(PasswordResetService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly token = tokenFromFragment(inject(ActivatedRoute).snapshot.fragment);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly expired = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
    confirmation: ['', Validators.required],
  }, { validators: matchingPasswords });

  constructor() {
    // Tira o token da barra de endereço e do histórico do navegador.
    if (this.token) history.replaceState(history.state, '', location.pathname);
  }

  protected submit(): void {
    if (this.loading() || !this.token) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(this.form.controls.password.invalid ? 'A nova senha deve ter de 12 a 128 caracteres.' : '');
      return;
    }
    this.error.set('');
    this.expired.set(false);
    this.loading.set(true);
    this.api.reset(this.token, this.form.controls.password.value).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: () => {
        // A redefinição encerra todas as sessões, inclusive a deste navegador, se houver.
        if (this.auth.status() === 'authenticated') this.auth.logout();
        void this.router.navigate(['/login'], { queryParams: { reset: '1' }, replaceUrl: true });
      },
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        this.expired.set(status === 400 && this.form.valid);
        this.error.set(status === 400
          ? 'Este link é inválido, já foi usado ou expirou. Peça uma nova redefinição.'
          : status === 429
          ? 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
          : 'Não foi possível redefinir a senha. Verifique sua conexão e tente novamente.');
      },
    });
  }
}
