import { DOCUMENT, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { canManageOrganization } from '../../organizations/organization.models';
import { OrganizationsService } from '../../organizations/organizations.service';
import { ATTACHMENT_EXTENSIONS, TaskAttachment, formatBytes, localFileProblem } from './attachment.models';
import { TaskAttachmentsService } from './task-attachments.service';

@Component({
  selector: 'app-task-attachments',
  imports: [DatePipe],
  providers: [TaskAttachmentsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-attachments.component.html',
  styleUrl: './task-attachments.component.scss',
})
export class TaskAttachmentsComponent {
  readonly taskId = input.required<string>();
  private readonly api = inject(TaskAttachmentsService);
  private readonly auth = inject(AuthService);
  private readonly organizations = inject(OrganizationsService);
  private readonly document = inject(DOCUMENT);
  protected readonly accept = ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`).join(',');
  protected readonly formatBytes = formatBytes;
  protected readonly attachments = signal<TaskAttachment[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly actionError = signal('');
  protected readonly uploadPercent = signal<number | null>(null);
  protected readonly uploadName = signal('');
  protected readonly busyId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  private readonly userId = computed(() => this.auth.user()?.id ?? null);
  private readonly canModerate = computed(() => {
    const organization = this.organizations.active();
    return organization ? canManageOrganization(organization.role) : false;
  });
  private requests = new Subscription();

  constructor() {
    effect((onCleanup) => {
      const taskId = this.taskId();
      this.organizations.active();
      this.requests.unsubscribe();
      this.requests = new Subscription();
      this.attachments.set([]);
      this.loading.set(true);
      this.loadError.set('');
      this.actionError.set('');
      this.uploadPercent.set(null);
      this.busyId.set(null);
      this.confirmingId.set(null);
      this.requests.add(this.api.list(taskId).subscribe({
        next: (attachments) => {
          this.attachments.set(attachments);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(this.message(error, 'Não foi possível carregar os anexos.'));
          this.loading.set(false);
        },
      }));
      onCleanup(() => this.requests.unsubscribe());
    });
  }

  protected canDelete(attachment: TaskAttachment): boolean {
    return attachment.uploader.id === this.userId() || this.canModerate();
  }

  protected selected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadPercent() !== null) return;
    const problem = localFileProblem(file);
    this.actionError.set(problem ?? '');
    if (problem) return;
    this.uploadName.set(file.name);
    this.uploadPercent.set(0);
    this.requests.add(this.api.upload(this.taskId(), file).subscribe({
      next: (progress) => {
        if (progress.kind === 'progress') {
          this.uploadPercent.set(progress.percent);
        } else {
          this.attachments.update((items) => [...items, progress.attachment]);
          this.uploadPercent.set(null);
        }
      },
      error: (error: unknown) => {
        this.uploadPercent.set(null);
        this.actionError.set(this.message(error, 'Não foi possível confirmar o envio. Atualize a tarefa antes de tentar novamente.'));
      },
    }));
  }

  /** Obtém a URL assinada e inicia o download; o arquivo é sempre baixado, nunca exibido na página. */
  protected download(attachment: TaskAttachment): void {
    if (this.busyId()) return;
    this.busyId.set(attachment.id);
    this.actionError.set('');
    this.requests.add(this.api.downloadUrl(this.taskId(), attachment.id).subscribe({
      next: (url) => {
        this.busyId.set(null);
        const link = this.document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.download = attachment.fileName;
        this.document.body.appendChild(link);
        link.click();
        link.remove();
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.actionError.set(this.message(error, 'Não foi possível baixar o anexo.'));
      },
    }));
  }

  protected remove(attachment: TaskAttachment): void {
    if (this.busyId()) return;
    this.busyId.set(attachment.id);
    this.actionError.set('');
    this.requests.add(this.api.remove(this.taskId(), attachment.id).subscribe({
      next: () => {
        this.attachments.update((items) => items.filter((item) => item.id !== attachment.id));
        this.busyId.set(null);
        this.confirmingId.set(null);
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.attachments.update((items) => items.filter((item) => item.id !== attachment.id));
        }
        this.busyId.set(null);
        this.confirmingId.set(null);
        this.actionError.set(this.message(error, 'Não foi possível excluir o anexo.'));
      },
    }));
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 413) return 'O arquivo excede o limite de 10 MB.';
      if (error.status === 415) return 'Tipo de arquivo não permitido ou conteúdo diferente da extensão.';
      if (error.status === 409) return 'Esta tarefa já tem o máximo de 20 anexos.';
      if (error.status === 503) return 'Os anexos estão indisponíveis: o armazenamento não está configurado.';
      if (error.status === 403) return 'Você não tem permissão para esta ação no anexo.';
      if (error.status === 404) return 'Anexo ou tarefa não encontrado. Ele pode ter sido removido.';
    }
    return fallback;
  }
}
