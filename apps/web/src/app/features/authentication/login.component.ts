import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService, SessionStorageError } from '../../core/auth/auth.service';
import { AuthShellComponent } from './auth-shell.component';

@Component({
  selector: 'app-login',
  imports: [AuthShellComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './auth-form.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly registered = inject(ActivatedRoute).snapshot.queryParamMap.get('registered') === '1';
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set('');
    this.loading.set(true);
    const value = this.form.getRawValue();
    this.auth.login({ email: value.email.trim(), password: value.password }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: () => { void this.router.navigateByUrl('/'); },
      error: (error: unknown) => this.error.set(
        error instanceof SessionStorageError
          ? 'Não foi possível armazenar a sessão neste navegador.'
          : error instanceof HttpErrorResponse && error.status === 401
          ? 'E-mail ou senha inválidos.'
          : 'Não foi possível entrar. Verifique sua conexão e tente novamente.',
      ),
    });
  }
}
