import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateTask, Task, UpdateTask, statusLabel } from './task.models';
import { TaskFormComponent } from './task-form.component';
import { TaskCommentsComponent } from './comments/task-comments.component';
import { ActivityFeedComponent } from '../activity/activity-feed.component';
import { TasksService } from './tasks.service';

@Component({
  selector: 'app-task-detail',
  imports: [ActivityFeedComponent, DatePipe, TaskCommentsComponent, TaskFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.scss',
})
export class TaskDetailComponent {
  readonly taskId = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<string>();
  private readonly api = inject(TasksService);
  private readonly organizations = inject(OrganizationsService);
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload = signal(0);
  protected readonly task = signal<Task | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly conflict = signal(false);
  protected readonly editing = signal(false);
  protected readonly confirming = signal(false);
  protected readonly statusLabel = statusLabel;

  constructor() {
    effect((onCleanup) => {
      const taskId = this.taskId();
      const organizationId = this.activeId();
      this.reload();
      this.task.set(null);
      this.error.set('');
      this.conflict.set(false);
      this.confirming.set(false);
      this.editing.set(false);
      if (!organizationId) return;
      this.loading.set(true);
      const request = this.api.detail(taskId).subscribe({
        next: (task) => {
          if (this.organizations.active()?.id !== organizationId) return;
          this.task.set(task);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          if (this.organizations.active()?.id !== organizationId) return;
          this.error.set(this.errorMessage(error));
          this.loading.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  protected refresh(): void {
    this.reload.update((value) => value + 1);
  }

  protected save(data: CreateTask | UpdateTask): void {
    const task = this.task();
    const organizationId = this.organizations.active()?.id;
    if (!task || !organizationId || this.busy() || this.conflict() || !('version' in data)) return;
    this.busy.set(true);
    this.error.set('');
    this.api.update(task.id, data).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (this.organizations.active()?.id !== organizationId) return;
        this.busy.set(false);
        this.changed.emit('Tarefa atualizada.');
      },
      error: (error: unknown) => this.mutationError(error, organizationId),
    });
  }

  protected remove(): void {
    const task = this.task();
    const organizationId = this.organizations.active()?.id;
    if (!task || !organizationId || this.busy() || this.conflict()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.delete(task.id, task.version).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (this.organizations.active()?.id !== organizationId) return;
        this.busy.set(false);
        this.changed.emit('Tarefa excluída.');
      },
      error: (error: unknown) => this.mutationError(error, organizationId),
    });
  }

  private mutationError(error: unknown, organizationId: string): void {
    if (this.organizations.active()?.id !== organizationId) return;
    this.busy.set(false);
    if (error instanceof HttpErrorResponse && error.status === 409) {
      this.conflict.set(true);
      this.error.set('A tarefa foi alterada por outra operação. Recarregue os dados antes de tentar novamente.');
    } else {
      if (!(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500 || error.status === 404) {
        this.conflict.set(true);
      }
      this.error.set(this.errorMessage(error));
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'Operação não permitida. Confira o responsável e suas permissões.';
    }
    if (error instanceof HttpErrorResponse && error.status === 404) {
      return 'Tarefa ou organização não encontrada, ou acesso indisponível.';
    }
    if (error instanceof HttpErrorResponse && error.status === 400) {
      return 'Dados inválidos. Confira os campos e tente novamente.';
    }
    return 'Não foi possível confirmar a operação. Recarregue os dados antes de tentar novamente.';
  }
}
