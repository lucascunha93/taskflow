import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { trimmedName } from '../../shared/validators/trimmed-name.validator';
import { ROLE_LABELS, canManageOrganization } from './organization.models';
import { OrganizationsService } from './organizations.service';

@Component({
  selector: 'app-organization-settings',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './organization-settings.component.html',
  styleUrls: ['./organization-page.scss', './organization-settings.component.scss'],
})
export class OrganizationSettingsComponent {
  protected readonly organizations = inject(OrganizationsService);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly roleLabels = ROLE_LABELS;
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  protected readonly canManage = computed(() => {
    const organization = this.organizations.active();
    return organization ? canManageOrganization(organization.role) : false;
  });
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly form = this.fb.group({ name: ['', trimmedName] });
  private request: Subscription | null = null;

  constructor() {
    // Cada troca de organização descarta edições, mensagens e requisições do contexto anterior.
    effect((onCleanup) => {
      this.activeId();
      const organization = untracked(() => this.organizations.active());
      this.form.reset({ name: organization?.name ?? '' });
      this.error.set('');
      this.notice.set('');
      this.saving.set(false);
      onCleanup(() => {
        this.request?.unsubscribe();
        this.request = null;
      });
    });
  }

  protected submit(): void {
    const organization = this.organizations.active();
    if (!organization || !this.canManage() || this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const name = this.form.controls.name.value.trim();
    if (name === organization.name) {
      this.notice.set('Nenhuma alteração para salvar.');
      return;
    }
    this.error.set('');
    this.notice.set('');
    this.saving.set(true);
    this.request = this.organizations.rename(organization.id, name).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.form.reset({ name: updated.name });
        this.notice.set('Nome da organização atualizado.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.error.set(this.errorMessage(error));
      },
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 400) return 'Informe um nome com 2 a 120 caracteres.';
      if (error.status === 403) return 'Você não tem permissão para alterar esta organização.';
      if (error.status === 404) return 'Organização não encontrada ou acesso indisponível.';
    }
    return 'Não foi possível confirmar a alteração. Verifique a conexão e recarregue antes de tentar novamente.';
  }
}
