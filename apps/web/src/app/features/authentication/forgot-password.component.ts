import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthShellComponent } from './auth-shell.component';
import { PasswordResetService } from './password-reset.service';

@Component({
  selector: 'app-forgot-password',
  imports: [AuthShellComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-shell>
      <p class="eyebrow">Recuperar acesso</p>
      <h1>Esqueceu a senha?</h1>
      @if (sent()) {
        <p class="message message--info" role="status">
          Se houver uma conta com <strong>{{ sent() }}</strong>, enviamos um link para redefinir a senha.
          Ele vale por 30 minutos. Confira também a caixa de spam.
        </p>
        <p class="switch"><a routerLink="/login">Voltar para o login</a></p>
      } @else {
        <p class="intro">Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate [attr.aria-busy]="loading()">
          @if (error()) { <p class="message" role="alert">{{ error() }}</p> }
          <div class="field">
            <label for="forgot-email">E-mail</label>
            <input id="forgot-email" class="tf-field" type="email" formControlName="email" autocomplete="email"
              [attr.aria-invalid]="form.controls.email.touched && form.controls.email.invalid"
              [attr.aria-describedby]="form.controls.email.touched && form.controls.email.invalid ? 'forgot-email-error' : null" />
            @if (form.controls.email.touched && form.controls.email.invalid) {
              <p id="forgot-email-error" class="field-error">Informe um e-mail válido com até 254 caracteres.</p>
            }
          </div>
          <button class="tf-button submit" type="submit" [disabled]="loading()">
            {{ loading() ? 'Enviando…' : 'Enviar link' }}
          </button>
        </form>
        <p class="switch">Lembrou a senha? <a routerLink="/login">Entrar</a></p>
      }
    </app-auth-shell>
  `,
})
export class ForgotPasswordComponent {
  private readonly api = inject(PasswordResetService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly sent = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
  });

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const email = this.form.controls.email.value.trim();
    this.error.set('');
    this.loading.set(true);
    this.api.forgot(email).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))).subscribe({
      next: () => this.sent.set(email),
      error: (error: unknown) => this.error.set(
        error instanceof HttpErrorResponse && error.status === 429
          ? 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
          : error instanceof HttpErrorResponse && error.status === 503
          ? 'A recuperação de senha não está disponível no momento. Fale com o suporte.'
          : 'Não foi possível enviar o pedido. Verifique sua conexão e tente novamente.',
      ),
    });
  }
}
