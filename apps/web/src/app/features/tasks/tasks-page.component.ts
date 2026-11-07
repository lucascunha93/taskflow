import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { debounceTime, map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { MembersService } from '../members/members.service';
import { ProjectsService } from '../projects/projects.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateTask, TASK_STATUSES, TaskPage, TaskQuery, TaskSort, TaskStatus, UpdateTask, statusLabel } from './task.models';
import { TaskDetailComponent } from './task-detail.component';
import { TaskFormComponent } from './task-form.component';
import { TasksService } from './tasks.service';

const initialQuery = (): TaskQuery => ({
  page: 1, limit: 20, status: '', assigneeId: '', creatorId: '', projectId: '', search: '',
  dueDateFrom: '', dueDateTo: '', sortBy: 'updatedAt', sortOrder: 'desc',
});

/**
 * Estado inicial aceito pela URL: `?assignee=me`, `?search=texto` e
 * `?task=<id>`, que abre o detalhe (usado pelas notificações).
 */
interface RouteFilters {
  mine: boolean;
  search: string;
  task: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const routeFilters = (params: ParamMap): RouteFilters => ({
  mine: params.get('assignee') === 'me',
  search: (params.get('search') ?? '').trim().slice(0, 200),
  task: UUID.test(params.get('task') ?? '') ? params.get('task') ?? '' : '',
});

@Component({
  selector: 'app-tasks-page',
  imports: [DatePipe, ReactiveFormsModule, RouterLink, TaskDetailComponent, TaskFormComponent],
  providers: [TasksService, MembersService, ProjectsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tasks-page.component.html',
  styleUrl: './tasks-page.component.scss',
})
export class TasksPageComponent {
  protected readonly organizations = inject(OrganizationsService);
  protected readonly members = inject(MembersService);
  protected readonly projects = inject(ProjectsService);
  private readonly api = inject(TasksService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly activeId = computed(() => this.organizations.active()?.id ?? null);
  private readonly routeFilters = toSignal(this.route.queryParamMap.pipe(map(routeFilters)), {
    initialValue: routeFilters(this.route.snapshot.queryParamMap),
  });
  /** Somente os filtros; mudar apenas `?task` não reinicia a página. */
  private readonly filterParams = computed(() => {
    const { mine, search } = this.routeFilters();
    return { mine, search };
  }, { equal: (a, b) => a.mine === b.mine && a.search === b.search });
  private readonly taskParam = computed(() => this.routeFilters().task);
  protected readonly mine = computed(() => this.filterParams().mine);
  private readonly contextId = signal<string | null>(null);
  private readonly query = signal<TaskQuery>(initialQuery());
  private readonly reload = signal(0);
  private readonly pageState = signal<TaskPage | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal('');
  protected readonly contextMatches = computed(() => this.activeId() === this.contextId());
  protected readonly visiblePage = computed(() => this.activeId() === this.contextId() ? this.pageState() : null);
  protected readonly filterPeople = computed(() => {
    const people = new Map<string, string>();
    for (const member of this.members.members()) people.set(member.user.id, member.user.name);
    for (const task of this.visiblePage()?.data ?? []) {
      people.set(task.creator.id, task.creator.name);
      if (task.assignee) people.set(task.assignee.id, task.assignee.name);
    }
    const query = this.query();
    for (const id of [query.creatorId, query.assigneeId]) {
      if (id && !people.has(id)) people.set(id, 'Pessoa selecionada');
    }
    return Array.from(people, ([id, name]) => ({ id, name }));
  });
  protected readonly loading = computed(() => this.activeId() !== this.contextId() || this.loadingState());
  protected readonly error = computed(() => this.activeId() === this.contextId() ? this.errorState() : '');
  protected readonly filterError = signal('');
  protected readonly creating = signal(false);
  protected readonly createBusy = signal(false);
  protected readonly createUncertain = signal(false);
  protected readonly createError = signal('');
  protected readonly selected = signal<{ id: string; organizationId: string } | null>(null);
  protected readonly notice = signal('');
  protected readonly statuses = TASK_STATUSES;
  protected readonly statusLabel = statusLabel;
  protected readonly filters = this.fb.group({
    search: [''],
    status: this.fb.control<TaskStatus | ''>(''),
    assigneeId: [''],
    creatorId: [''],
    projectId: [''],
    dueDateFrom: [''],
    dueDateTo: [''],
    sortBy: this.fb.control<TaskSort>('updatedAt'),
    sortOrder: this.fb.control<'asc' | 'desc'>('desc'),
    limit: this.fb.control(20),
  });

  constructor() {
    this.filters.valueChanges.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const filters = this.filters.getRawValue();
      if (filters.dueDateFrom && filters.dueDateTo && filters.dueDateFrom > filters.dueDateTo) {
        this.filterError.set('A data inicial não pode ser posterior à data final. Os filtros ainda não foram aplicados.');
        return;
      }
      this.filterError.set('');
      this.query.set({ ...filters, search: filters.search.trim(), page: 1, limit: Number(filters.limit) });
    });

    effect(() => {
      this.activeId();
      const fromRoute = this.filterParams();
      const assigneeId = fromRoute.mine ? untracked(() => this.auth.user()?.id) ?? '' : '';
      this.filters.reset({
        search: fromRoute.search, status: '', assigneeId, creatorId: '', projectId: '', dueDateFrom: '', dueDateTo: '',
        sortBy: 'updatedAt', sortOrder: 'desc', limit: 20,
      }, { emitEvent: false });
      this.query.set({ ...initialQuery(), search: fromRoute.search, assigneeId });
      this.filterError.set('');
      this.creating.set(false);
      this.createBusy.set(false);
      this.createUncertain.set(false);
      this.createError.set('');
      this.selected.set(null);
      this.notice.set('');
    });

    // Abre o detalhe pedido pela URL (por exemplo, a partir de uma notificação).
    effect(() => {
      const taskId = this.taskParam();
      const organizationId = this.activeId();
      if (taskId && organizationId) {
        untracked(() => this.selected.set({ id: taskId, organizationId }));
      }
    });

    effect((onCleanup) => {
      const organizationId = this.activeId();
      const query = this.query();
      this.reload();
      this.contextId.set(organizationId);
      this.pageState.set(null);
      this.errorState.set('');
      if (!organizationId) {
        this.loadingState.set(false);
        return;
      }
      this.loadingState.set(true);
      const request = this.api.list(query).subscribe({
        next: (page) => {
          if (this.activeId() !== organizationId) return;
          if (page.meta.page > Math.max(1, page.meta.totalPages)) {
            this.query.update((current) => ({ ...current, page: Math.max(1, page.meta.totalPages) }));
            return;
          }
          this.pageState.set(page);
          this.loadingState.set(false);
        },
        error: (error: unknown) => {
          if (this.activeId() !== organizationId) return;
          this.errorState.set(error instanceof HttpErrorResponse && error.status === 403
            ? 'Você não tem permissão para consultar as tarefas.'
            : error instanceof HttpErrorResponse && error.status === 404
              ? 'Organização não encontrada ou acesso indisponível.'
              : 'Não foi possível carregar as tarefas. Verifique a conexão e tente novamente.');
          this.loadingState.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  protected page(number: number): void {
    this.query.update((query) => ({ ...query, page: number }));
  }

  protected refresh(): void {
    this.reload.update((value) => value + 1);
  }

  protected open(taskId: string): void {
    const organizationId = this.activeId();
    if (!organizationId) return;
    this.notice.set('');
    this.selected.set({ id: taskId, organizationId });
  }

  protected create(data: CreateTask | UpdateTask): void {
    const organizationId = this.activeId();
    if (!organizationId || this.createBusy() || this.createUncertain() || 'version' in data) return;
    this.createError.set('');
    this.createBusy.set(true);
    this.api.create(data).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (this.activeId() !== organizationId) return;
        this.createBusy.set(false);
        this.creating.set(false);
        this.notice.set('Tarefa criada.');
        this.refresh();
      },
      error: (error: unknown) => {
        if (this.activeId() !== organizationId) return;
        this.createBusy.set(false);
        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.createError.set('Operação não permitida. Confira o responsável e suas permissões.');
        } else if (error instanceof HttpErrorResponse && error.status === 404) {
          this.createError.set('Organização não encontrada ou acesso indisponível.');
        } else if (error instanceof HttpErrorResponse && error.status === 400) {
          this.createError.set('Dados inválidos. Confira os campos e tente novamente.');
        } else {
          this.createUncertain.set(true);
          this.createError.set('Não foi possível confirmar a criação. Volte e atualize a lista antes de tentar novamente.');
        }
      },
    });
  }

  protected cancelCreate(): void {
    this.creating.set(false);
    this.createError.set('');
    if (this.createUncertain()) {
      this.notice.set('Criação não confirmada. Confira a lista antes de tentar novamente.');
      this.createUncertain.set(false);
      this.refresh();
    }
  }

  /** Fecha o detalhe e remove `?task` da URL, para que um novo link para a mesma tarefa funcione. */
  protected closeDetail(): void {
    this.selected.set(null);
    if (this.routeFilters().task) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { task: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  protected changed(message: string): void {
    this.closeDetail();
    this.notice.set(message);
    this.refresh();
  }
}
