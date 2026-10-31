import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OrganizationsService } from '../organizations/organizations.service';
import { TASK_STATUSES, TaskStatus } from '../tasks/task.models';
import { TasksService } from '../tasks/tasks.service';
import { DashboardSummary, DashboardTask } from './dashboard.models';
import { DashboardTaskDetailComponent } from './dashboard-task-detail.component';
import { DashboardTaskListComponent } from './dashboard-task-list.component';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, RouterLink, DashboardTaskDetailComponent, DashboardTaskListComponent],
  providers: [TasksService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  protected readonly organizations = inject(OrganizationsService);
  private readonly tasks = inject(TasksService);
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private readonly contextId = signal<string | null>(null);
  private readonly summaryState = signal<DashboardSummary | null>(null);
  private readonly statusState = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly errorState = signal('');
  private readonly reload = signal(0);
  protected readonly selected = signal<{ id: string; organizationId: string } | null>(null);
  protected readonly notice = signal('');
  protected readonly summary = computed(() => this.activeId() === this.contextId() ? this.summaryState() : null);
  protected readonly status = computed(() => this.activeId() === this.contextId() ? this.statusState() : 'loading');
  protected readonly error = computed(() => this.activeId() === this.contextId() ? this.errorState() : '');
  protected readonly statuses = TASK_STATUSES;

  constructor() {
    effect(() => {
      this.activeId();
      this.selected.set(null);
      this.notice.set('');
    });
    effect((onCleanup) => {
      const organizationId = this.activeId();
      this.reload();
      this.contextId.set(organizationId);
      this.summaryState.set(null);
      this.errorState.set('');
      this.statusState.set('loading');
      if (!organizationId) return;
      const request = this.tasks.summary().subscribe({
        next: (summary) => {
          if (this.activeId() !== organizationId) return;
          this.summaryState.set(summary);
          this.statusState.set('ready');
        },
        error: (error: unknown) => {
          if (this.activeId() !== organizationId) return;
          this.errorState.set(error instanceof HttpErrorResponse && error.status === 404
            ? 'Organização não encontrada ou acesso indisponível.'
            : error instanceof HttpErrorResponse && error.status === 403
              ? 'Você não tem permissão para consultar este dashboard.'
              : 'Não foi possível carregar o dashboard. Verifique a conexão e tente novamente.');
          this.statusState.set('error');
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  protected refresh(): void {
    this.reload.update((value) => value + 1);
  }

  protected open(task: DashboardTask): void {
    if (task.organizationId === this.activeId()) {
      this.selected.set({ id: task.id, organizationId: task.organizationId });
      this.notice.set('');
    }
  }

  protected changed(message: string): void {
    this.selected.set(null);
    this.notice.set(message);
    this.refresh();
  }

  protected percent(status: TaskStatus, summary: DashboardSummary): number {
    return summary.total === 0 ? 0 : (summary.counts[status] / summary.total) * 100;
  }

}
