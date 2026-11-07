import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-end-sessions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './end-sessions.component.html',
  styleUrl: './profile-form.scss',
})
export class EndSessionsComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected endAll(): void {
    if (this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    this.auth.revokeAllSessions().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.busy.set(false)),
    ).subscribe({
      next: () => {
        void this.router.navigateByUrl(this.auth.status() === 'error' ? '/session-error' : '/login?sessions=ended');
      },
      error: (error: unknown) => {
        // Um 401 já encerra a sessão pelo interceptor e redireciona ao login.
        if (error instanceof HttpErrorResponse && error.status === 401) return;
        this.error.set('Não foi possível encerrar as sessões. Verifique a conexão e tente novamente.');
      },
    });
  }
}
