import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, forkJoin, map } from 'rxjs';
import { MembersService } from '../members/members.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TaskDetailComponent } from '../tasks/task-detail.component';
import { TaskFormComponent } from '../tasks/task-form.component';
import { CreateTask, TASK_STATUSES, Task, TaskQuery, TaskStatus, UpdateTask } from '../tasks/task.models';
import { TasksService } from '../tasks/tasks.service';
import { Project } from './project.models';
import { ProjectsService } from './projects.service';

/** Cartões por coluna; acima disso o quadro indica que há mais tarefas na lista. */
export const BOARD_COLUMN_LIMIT = 100;

interface Column {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  total: number;
}

const columnQuery = (projectId: string, status: TaskStatus): TaskQuery => ({
  page: 1, limit: BOARD_COLUMN_LIMIT, status, assigneeId: '', creatorId: '', projectId, search: '',
  dueDateFrom: '', dueDateTo: '', sortBy: 'updatedAt', sortOrder: 'desc',
});

@Component({
  selector: 'app-project-board',
  imports: [DatePipe, RouterLink, TaskDetailComponent, TaskFormComponent],
  providers: [TasksService, MembersService, ProjectsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-board.component.html',
  styleUrl: './project-board.component.scss',
})
export class ProjectBoardComponent {
  protected readonly organizations = inject(OrganizationsService);
  private readonly tasks = inject(TasksService);
  private readonly projects = inject(ProjectsService);
  private readonly projectId = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('projectId') ?? '')),
    { initialValue: '' });
  private readonly reload = signal(0);
  protected readonly project = signal<Project | null>(null);
  protected readonly columns = signal<Column[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly moveMessage = signal('');
  protected readonly movingId = signal<string | null>(null);
  protected readonly dropTarget = signal<TaskStatus | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly createBusy = signal(false);
  protected readonly createError = signal('');
  protected readonly notice = signal('');
  protected readonly statuses = TASK_STATUSES;
  protected readonly truncated = computed(() => this.columns().some((column) => column.total > column.tasks.length));
  private draggedId: string | null = null;
  private requests = new Subscription();

  constructor() {
    effect((onCleanup) => {
      const projectId = this.projectId();
      const organizationId = this.organizations.active()?.id;
      this.reload();
      this.requests.unsubscribe();
      this.requests = new Subscription();
      this.error.set('');
      this.loading.set(true);
      if (!organizationId || !projectId) {
        this.project.set(null);
        this.columns.set([]);
        this.loading.set(false);
        return;
      }
      this.requests.add(forkJoin({
        project: this.projects.get(projectId),
        columns: forkJoin(TASK_STATUSES.map((status) => this.tasks.list(columnQuery(projectId, status.value)))),
      }).subscribe({
        next: ({ project, columns }) => {
          this.project.set(project);
          this.columns.set(TASK_STATUSES.map((status, index) => ({
            status: status.value, label: status.label, tasks: columns[index].data, total: columns[index].meta.total,
          })));
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.project.set(null);
          this.columns.set([]);
          this.error.set(error instanceof HttpErrorResponse && error.status === 404
            ? 'Projeto não encontrado nesta organização.'
            : 'Não foi possível carregar o quadro. Verifique a conexão e tente novamente.');
          this.loading.set(false);
        },
      }));
      onCleanup(() => this.requests.unsubscribe());
    });
  }

  protected refresh(): void {
    this.reload.update((value) => value + 1);
  }

  protected move(task: Task, status: TaskStatus): void {
    if (task.status === status || this.movingId()) return;
    this.movingId.set(task.id);
    this.moveMessage.set('');
    this.requests.add(this.tasks.update(task.id, { version: task.version, status }).subscribe({
      next: (updated) => {
        this.columns.update((columns) => columns.map((column) => {
          if (column.status === task.status) {
            return { ...column, tasks: column.tasks.filter((item) => item.id !== task.id), total: column.total - 1 };
          }
          if (column.status === status) {
            return { ...column, tasks: [updated, ...column.tasks], total: column.total + 1 };
          }
          return column;
        }));
        this.movingId.set(null);
        this.moveMessage.set(`“${updated.title}” movida para ${this.label(status)}.`);
      },
      error: (error: unknown) => {
        this.movingId.set(null);
        this.moveMessage.set(error instanceof HttpErrorResponse && error.status === 409
          ? 'A tarefa foi alterada por outra pessoa. O quadro foi recarregado; tente mover de novo.'
          : 'Não foi possível mover a tarefa. O quadro foi recarregado.');
        this.refresh();
      },
    }));
  }

  protected onMoveSelect(task: Task, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const status = select.value as TaskStatus;
    select.value = task.status;
    this.move(task, status);
  }

  protected dragStart(task: Task, event: DragEvent): void {
    this.draggedId = task.id;
    event.dataTransfer?.setData('text/plain', task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dragOver(status: TaskStatus, event: DragEvent): void {
    if (!this.draggedId) return;
    event.preventDefault();
    this.dropTarget.set(status);
  }

  protected drop(status: TaskStatus, event: DragEvent): void {
    event.preventDefault();
    this.dropTarget.set(null);
    const id = this.draggedId ?? event.dataTransfer?.getData('text/plain');
    this.draggedId = null;
    const task = this.columns().flatMap((column) => column.tasks).find((item) => item.id === id);
    if (task) this.move(task, status);
  }

  protected dragEnd(): void {
    this.draggedId = null;
    this.dropTarget.set(null);
  }

  protected create(data: CreateTask | UpdateTask): void {
    const project = this.project();
    if (!project || this.createBusy() || 'version' in data) return;
    this.createBusy.set(true);
    this.createError.set('');
    this.requests.add(this.tasks.create({ ...data, projectId: project.id }).subscribe({
      next: () => {
        this.createBusy.set(false);
        this.creating.set(false);
        this.notice.set('Tarefa criada no projeto.');
        this.refresh();
      },
      error: (error: unknown) => {
        this.createBusy.set(false);
        this.createError.set(error instanceof HttpErrorResponse && error.status === 400
          ? 'Dados inválidos ou projeto indisponível. Confira os campos.'
          : 'Não foi possível confirmar a criação. Recarregue o quadro antes de tentar novamente.');
      },
    }));
  }

  protected changed(message: string): void {
    this.selectedId.set(null);
    this.notice.set(message);
    this.refresh();
  }

  private label(status: TaskStatus): string {
    return TASK_STATUSES.find((item) => item.value === status)?.label ?? status;
  }
}
