import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { canManageOrganization } from '../../organizations/organization.models';
import { OrganizationsService } from '../../organizations/organizations.service';
import { COMMENT_MAX_LENGTH, TaskComment } from './task-comment.models';
import { TaskCommentsService } from './task-comments.service';

const bodyValidators = [Validators.required, Validators.maxLength(COMMENT_MAX_LENGTH), Validators.pattern(/\S/)];

@Component({
  selector: 'app-task-comments',
  imports: [DatePipe, ReactiveFormsModule],
  providers: [TaskCommentsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-comments.component.html',
  styleUrl: './task-comments.component.scss',
})
export class TaskCommentsComponent {
  readonly taskId = input.required<string>();
  private readonly api = inject(TaskCommentsService);
  private readonly auth = inject(AuthService);
  private readonly organizations = inject(OrganizationsService);
  protected readonly maxLength = COMMENT_MAX_LENGTH;
  protected readonly comments = signal<TaskComment[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly loadError = signal('');
  protected readonly posting = signal(false);
  protected readonly actionError = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly draft = new FormControl('', { nonNullable: true, validators: bodyValidators });
  protected readonly editDraft = new FormControl('', { nonNullable: true, validators: bodyValidators });
  protected readonly userId = computed(() => this.auth.user()?.id ?? null);
  protected readonly canModerate = computed(() => {
    const organization = this.organizations.active();
    return organization ? canManageOrganization(organization.role) : false;
  });
  private requests = new Subscription();

  constructor() {
    effect((onCleanup) => {
      const taskId = this.taskId();
      this.organizations.active();
      this.reset();
      this.requests.add(this.api.list(taskId).subscribe({
        next: (page) => {
          this.comments.set(page.data);
          this.nextCursor.set(page.nextCursor);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(this.message(error, 'Não foi possível carregar os comentários.'));
          this.loading.set(false);
        },
      }));
      onCleanup(() => this.requests.unsubscribe());
    });
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.requests.add(this.api.list(this.taskId(), cursor).subscribe({
      next: (page) => {
        this.comments.update((current) => [...current, ...page.data.filter((item) => !current.some((known) => known.id === item.id))]);
        this.nextCursor.set(page.nextCursor);
        this.loadingMore.set(false);
      },
      error: (error: unknown) => {
        this.actionError.set(this.message(error, 'Não foi possível carregar mais comentários.'));
        this.loadingMore.set(false);
      },
    }));
  }

  protected submit(): void {
    if (this.posting()) return;
    if (this.draft.invalid) {
      this.draft.markAsTouched();
      return;
    }
    this.posting.set(true);
    this.actionError.set('');
    this.requests.add(this.api.create(this.taskId(), this.draft.value.trim()).subscribe({
      next: (comment) => {
        // Mantém a ordem cronológica; sem mais páginas, o novo comentário é o último.
        if (!this.nextCursor()) this.comments.update((current) => [...current, comment]);
        this.draft.reset();
        this.posting.set(false);
      },
      error: (error: unknown) => {
        this.actionError.set(this.message(error, 'Não foi possível confirmar o comentário. Recarregue antes de enviar de novo.'));
        this.posting.set(false);
      },
    }));
  }

  protected startEdit(comment: TaskComment): void {
    this.confirmingId.set(null);
    this.actionError.set('');
    this.editDraft.reset(comment.body);
    this.editingId.set(comment.id);
  }

  protected saveEdit(comment: TaskComment): void {
    if (this.busyId()) return;
    if (this.editDraft.invalid) {
      this.editDraft.markAsTouched();
      return;
    }
    this.busyId.set(comment.id);
    this.requests.add(this.api.update(this.taskId(), comment.id, this.editDraft.value.trim()).subscribe({
      next: (updated) => {
        this.comments.update((current) => current.map((item) => item.id === updated.id ? updated : item));
        this.editingId.set(null);
        this.busyId.set(null);
      },
      error: (error: unknown) => {
        this.actionError.set(this.message(error, 'Não foi possível salvar a edição.'));
        this.busyId.set(null);
      },
    }));
  }

  protected remove(comment: TaskComment): void {
    if (this.busyId()) return;
    this.busyId.set(comment.id);
    this.actionError.set('');
    this.requests.add(this.api.remove(this.taskId(), comment.id).subscribe({
      next: () => {
        this.comments.update((current) => current.filter((item) => item.id !== comment.id));
        this.confirmingId.set(null);
        this.busyId.set(null);
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.comments.update((current) => current.filter((item) => item.id !== comment.id));
        }
        this.actionError.set(this.message(error, 'Não foi possível excluir o comentário.'));
        this.confirmingId.set(null);
        this.busyId.set(null);
      },
    }));
  }

  protected canDelete(comment: TaskComment): boolean {
    return comment.author.id === this.userId() || this.canModerate();
  }

  private reset(): void {
    this.requests.unsubscribe();
    this.requests = new Subscription();
    this.comments.set([]);
    this.nextCursor.set(null);
    this.loading.set(true);
    this.loadingMore.set(false);
    this.loadError.set('');
    this.actionError.set('');
    this.posting.set(false);
    this.editingId.set(null);
    this.confirmingId.set(null);
    this.busyId.set(null);
    this.draft.reset();
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 403) return 'Você não tem permissão para esta ação no comentário.';
      if (error.status === 404) return 'Comentário ou tarefa não encontrado. Ele pode ter sido removido.';
      if (error.status === 400) return `O comentário deve ter de 1 a ${COMMENT_MAX_LENGTH} caracteres.`;
    }
    return fallback;
  }
}
