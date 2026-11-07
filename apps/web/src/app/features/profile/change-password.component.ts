import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { matchingPasswords } from '../authentication/auth-form.validators';

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './change-password.component.html',
  styleUrl: './profile-form.scss',
})
export class ChangePasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', [Validators.required, Validators.maxLength(128)]],
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
    confirmation: ['', Validators.required],
  }, { validators: matchingPasswords });

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, password } = this.form.getRawValue();
    if (currentPassword === password) {
      this.error.set('A nova senha deve ser diferente da atual.');
      return;
    }
    this.error.set('');
    this.notice.set('');
    this.saving.set(true);
    this.auth.changePassword(currentPassword, password).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.form.reset();
        this.notice.set('Senha alterada. As outras sessões foram encerradas.');
      },
      error: (error: unknown) => this.error.set(this.errorMessage(error)),
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 403) return 'A senha atual está incorreta.';
      if (error.status === 400) return 'A nova senha deve ter de 12 a 128 caracteres e ser diferente da atual.';
      if (error.status === 409) return 'A sessão foi alterada por outra operação. Entre novamente.';
      if (error.status === 429) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
    }
    return 'Não foi possível confirmar a troca de senha. Se ela tiver sido aplicada, entre novamente com a nova senha.';
  }
}
