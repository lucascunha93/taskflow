import { HttpErrorResponse } from '@angular/common/http';
import { planLimitMessage } from '../plans/plan.models';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { trimmedName } from '../../shared/validators/trimmed-name.validator';
import { OrganizationsService } from './organizations.service';

@Component({
  selector: 'app-create-organization',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-organization.component.html',
  styleUrl: './organization-page.scss',
})
export class CreateOrganizationComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly organizations = inject(OrganizationsService);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly form = this.fb.group({ name: ['', trimmedName] });

  protected submit(): void {
    if (this.loading() || this.organizations.status() !== 'ready') return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.error.set('');
    this.loading.set(true);
    this.organizations.create(this.form.controls.name.value.trim()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: (organization) => {
        void this.router.navigate(['/'], { info: { createdOrganizationId: organization.id } });
      },
      error: (error: unknown) => this.error.set(
        planLimitMessage(error) ?? (error instanceof HttpErrorResponse && error.status === 409
          ? 'Houve um conflito ao criar a organização. Tente novamente.'
          : 'Não foi possível criar a organização. Verifique a conexão e tente novamente.'),
      ),
    });
  }
}
