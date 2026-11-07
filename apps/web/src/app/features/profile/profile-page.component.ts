import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { trimmedName } from '../../shared/validators/trimmed-name.validator';
import { ROLE_LABELS } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';

@Component({
  selector: 'app-profile-page',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss',
})
export class ProfilePageComponent {
  protected readonly auth = inject(AuthService);
  protected readonly organizations = inject(OrganizationsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.auth.user()?.name ?? '', trimmedName],
  });

  protected submit(): void {
    const user = this.auth.user();
    if (!user || this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const name = this.form.controls.name.value.trim();
    if (name === user.name) {
      this.notice.set('Nenhuma alteração para salvar.');
      return;
    }
    this.error.set('');
    this.notice.set('');
    this.saving.set(true);
    this.auth.updateProfile(name).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: (updated) => {
        this.form.reset({ name: updated.name });
        this.notice.set('Perfil atualizado.');
      },
      error: (error: unknown) => this.error.set(
        error instanceof HttpErrorResponse && error.status === 400
          ? 'Informe um nome com 2 a 120 caracteres.'
          : 'Não foi possível atualizar o perfil. Verifique a conexão e tente novamente.',
      ),
    });
  }
}
