import { HttpErrorResponse } from '@angular/common/http';
import { planLimitMessage } from '../plans/plan.models';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { trimmedName } from '../../shared/validators/trimmed-name.validator';
import { canManageOrganization } from '../organizations/organization.models';
import { OrganizationsService } from '../organizations/organizations.service';
import { Project } from './project.models';
import { ProjectsService } from './projects.service';

@Component({
  selector: 'app-projects-page',
  imports: [ReactiveFormsModule, RouterLink],
  providers: [ProjectsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.scss',
})
export class ProjectsPageComponent {
  protected readonly organizations = inject(OrganizationsService);
  protected readonly projects = inject(ProjectsService);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly canManage = computed(() => {
    const organization = this.organizations.active();
    return organization ? canManageOrganization(organization.role) : false;
  });
  /** `null`: nenhum formulário; `'new'`: criação; caso contrário, o projeto em edição. */
  protected readonly editing = signal<Project | 'new' | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly form = this.fb.group({
    name: ['', trimmedName],
    description: ['', Validators.maxLength(2000)],
  });
  private request: Subscription | null = null;

  constructor() {
    effect((onCleanup) => {
      void this.organizations.active();
      this.editing.set(null);
      this.confirmingId.set(null);
      this.busy.set(false);
      this.error.set('');
      this.notice.set('');
      onCleanup(() => this.request?.unsubscribe());
    });
  }

  protected startCreate(): void {
    this.form.reset({ name: '', description: '' });
    this.error.set('');
    this.notice.set('');
    this.editing.set('new');
  }

  protected startEdit(project: Project): void {
    this.form.reset({ name: project.name, description: project.description ?? '' });
    this.error.set('');
    this.notice.set('');
    this.confirmingId.set(null);
    this.editing.set(project);
  }

  protected save(): void {
    const target = this.editing();
    if (!target || this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const input = { name: value.name.trim(), description: value.description.trim() || null };
    this.busy.set(true);
    this.error.set('');
    const request = target === 'new' ? this.projects.create(input) : this.projects.update(target.id, input);
    this.request = request.subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(null);
        this.notice.set(target === 'new' ? 'Projeto criado.' : 'Projeto atualizado.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(this.message(error));
      },
    });
  }

  protected remove(project: Project): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.request = this.projects.remove(project.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmingId.set(null);
        this.notice.set(`Projeto “${project.name}” excluído. As tarefas continuam na organização, sem projeto.`);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirmingId.set(null);
        this.error.set(this.message(error));
        if (error instanceof HttpErrorResponse && error.status === 404) this.projects.refresh();
      },
    });
  }

  private message(error: unknown): string {
    const planLimit = planLimitMessage(error);
    if (planLimit) return planLimit;
    if (error instanceof HttpErrorResponse) {
      if (error.status === 409) return 'Já existe um projeto com esse nome nesta organização.';
      if (error.status === 403) return 'Somente proprietários e administradores podem gerenciar projetos.';
      if (error.status === 404) return 'Projeto não encontrado. A lista foi atualizada.';
      if (error.status === 400) return 'Dados inválidos. Confira o nome e a descrição.';
    }
    return 'Não foi possível concluir a operação. Verifique a conexão e tente novamente.';
  }
}
