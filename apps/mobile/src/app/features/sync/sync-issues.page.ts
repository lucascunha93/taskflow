import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle,
  IonContent, IonHeader, IonTitle, IonToolbar,
} from '@ionic/angular';
import { OutboxOp, Resolution } from '../../offline/outbox.models';
import { SyncService } from '../../offline/sync.service';
import { Member, Project, TaskField, statusLabel, type TaskStatus } from '../../offline/task.models';

const FIELD_LABELS: Record<TaskField, string> = {
  title: 'Título', description: 'Descrição', status: 'Status', assigneeId: 'Responsável', projectId: 'Projeto', dueDate: 'Prazo',
};

export interface IssueView {
  seq: number;
  title: string;
  summary: string;
  details: string[];
  keepLabel: string;
  discardLabel: string;
}

/** Descreve uma operação em conflito ou com falha e as escolhas possíveis. */
export function describeIssue(op: OutboxOp, title: string, members: Member[], projects: Project[]): IssueView {
  const value = (field: TaskField, raw: unknown): string => {
    if (raw === null || raw === undefined || raw === '') return 'vazio';
    if (field === 'status') return statusLabel(raw as TaskStatus);
    if (field === 'assigneeId') return members.find((member) => member.id === raw)?.name ?? 'outro membro';
    if (field === 'projectId') return projects.find((project) => project.id === raw)?.name ?? 'outro projeto';
    if (field === 'dueDate') return new Date(String(raw)).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    return String(raw);
  };
  const base = { seq: op.seq!, title, details: [] as string[] };

  if (op.state === 'failed') {
    const action = op.kind === 'create' ? 'A criação' : op.kind === 'update' ? 'A alteração' : 'A exclusão';
    return { ...base, summary: `${action} foi recusada pelo servidor: ${op.error ?? 'erro desconhecido'}`,
      keepLabel: 'Tentar novamente', discardLabel: 'Descartar' };
  }
  if (op.kind === 'delete') {
    return { ...base, summary: 'Você excluiu esta tarefa, mas ela foi alterada por outra pessoa depois que você a viu.',
      keepLabel: 'Excluir mesmo assim', discardLabel: 'Manter a tarefa' };
  }
  if (op.kind === 'update' && op.conflict?.reason === 'deleted') {
    return { ...base, summary: 'Você alterou esta tarefa, mas ela foi excluída no servidor.',
      keepLabel: 'Recriar com minhas alterações', discardLabel: 'Descartar minhas alterações' };
  }
  return {
    ...base,
    summary: 'Esta tarefa foi alterada por outra pessoa nos mesmos campos que você.',
    details: (op.conflict?.fields ?? []).map((item) =>
      `${FIELD_LABELS[item.field]}: seu valor “${value(item.field, item.local)}”, no servidor “${value(item.field, item.server)}”`),
    keepLabel: 'Manter meus valores',
    discardLabel: 'Usar os do servidor',
  };
}

@Component({
  selector: 'app-sync-issues',
  imports: [
    IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonCard, IonCardHeader, IonCardTitle,
    IonCardSubtitle, IonCardContent, IonButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tarefas" text="" /></ion-buttons>
        <ion-title>Sincronização</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (issues().length === 0) {
        <p class="empty-state">Nenhuma alteração precisa da sua decisão.</p>
      }
      @for (issue of issues(); track issue.seq) {
        <ion-card>
          <ion-card-header>
            <ion-card-title>{{ issue.title }}</ion-card-title>
            <ion-card-subtitle>{{ issue.summary }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            @for (detail of issue.details; track detail) { <p>{{ detail }}</p> }
            <ion-button expand="block" [disabled]="busy()" (click)="resolve(issue.seq, 'keep-mine')">{{ issue.keepLabel }}</ion-button>
            <ion-button expand="block" fill="outline" [disabled]="busy()" (click)="resolve(issue.seq, 'discard')">{{ issue.discardLabel }}</ion-button>
          </ion-card-content>
        </ion-card>
      }
    </ion-content>
  `,
})
export class SyncIssuesPage {
  private readonly sync = inject(SyncService);
  protected readonly busy = signal(false);

  protected readonly issues = computed(() => {
    const titles = new Map(this.sync.tasks().map((task) => [task.id, task.title]));
    return this.sync.issues().map((op) => {
      const title = titles.get(op.taskId) ?? (op.kind === 'create' ? op.fields.title : 'Tarefa');
      return describeIssue(op, title, this.sync.members(), this.sync.projects());
    });
  });

  protected async resolve(seq: number, resolution: Resolution): Promise<void> {
    this.busy.set(true);
    try {
      await this.sync.resolve(seq, resolution);
    } finally {
      this.busy.set(false);
    }
  }
}
