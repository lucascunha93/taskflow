import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AuthShellComponent } from './auth-shell.component';

@Component({
  selector: 'app-session-error',
  imports: [AuthShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-shell>
      <p class="eyebrow">Sessão</p>
      <h1>Não foi possível verificar sua sessão</h1>
      <p class="intro" role="alert">Verifique sua conexão e se o armazenamento do navegador está disponível.</p>
      <button type="button" class="tf-button submit" [disabled]="loading()" (click)="retry()">
        {{ loading() ? 'Verificando…' : 'Tentar novamente' }}
      </button>
      <button type="button" class="tf-button tf-button--subtle submit" [disabled]="loading()" (click)="logout()">
        Sair da sessão
      </button>
    </app-auth-shell>
  `,
})
export class SessionErrorComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly loading = signal(false);

  protected retry(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.auth.restoreSession().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe((status) => {
      if (status !== 'error') void this.router.navigateByUrl(status === 'authenticated' ? '/' : '/login');
    });
  }

  protected logout(): void {
    this.auth.logout();
    if (this.auth.status() !== 'error') void this.router.navigateByUrl('/login');
  }
}
