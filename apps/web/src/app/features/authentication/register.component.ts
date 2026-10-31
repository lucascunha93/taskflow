import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AuthShellComponent } from './auth-shell.component';
import { matchingPasswords, trimmedName } from './auth-form.validators';

@Component({
  selector: 'app-register',
  imports: [AuthShellComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.component.html',
  styleUrl: './auth-form.scss',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly form = this.fb.group({
    name: ['', [trimmedName]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
    confirmation: ['', Validators.required],
  }, { validators: matchingPasswords });

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const value = this.form.getRawValue();
    this.auth.register({ name: value.name.trim(), email: value.email.trim(), password: value.password }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: () => { void this.router.navigate(['/login'], { queryParams: { registered: '1' } }); },
      error: (error: unknown) => this.error.set(
        error instanceof HttpErrorResponse && error.status === 409
          ? 'Este e-mail já está cadastrado.'
          : 'Não foi possível criar a conta. Verifique sua conexão e tente novamente.',
      ),
    });
  }
}
