import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList,
  IonNote, IonSelect, IonSelectOption, IonText, IonTextarea, IonTitle, IonToolbar,
} from '@ionic/angular';
import { TaskLockedError } from '../../offline/sync-engine';
import { SyncService } from '../../offline/sync.service';
import {
  TASK_STATUSES, TaskFields, TaskStatus, dueDateFromInput, dueDateToInput, fieldsOf, sameValue, TASK_FIELDS,
} from '../../offline/task.models';

const NONE = '';

@Component({
  selector: 'app-task-edit',
  imports: [
    ReactiveFormsModule, RouterLink, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList,
    IonItem, IonInput, IonTextarea, IonSelect, IonSelectOption, IonButton, IonIcon, IonText, IonNote,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-edit.page.html',
  styles: [`
    .actions { display: grid; gap: 12px; margin: 24px 16px; }
    .notice { display: block; margin: 16px; }
  `],
})
export class TaskEditPage {
  /** Parâmetro da rota; ausente em "Nova tarefa". */
  readonly taskId = input<string>();
  protected readonly sync = inject(SyncService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  protected readonly statuses = TASK_STATUSES;
  protected readonly none = NONE;
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly task = computed(() => {
    const id = this.taskId();
    return id ? this.sync.tasks().find((task) => task.id === id) ?? null : null;
  });
  protected readonly isNew = computed(() => !this.taskId());
  protected readonly locked = computed(() => {
    const sync = this.task()?.sync;
    return sync === 'conflict' || sync === 'failed';
  });

  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(180)]],
    description: ['', Validators.maxLength(5000)],
    status: ['TODO' as TaskStatus],
    assigneeId: [NONE],
    projectId: [NONE],
    dueDate: [''],
  });
  private loadedId: string | null = null;

  constructor() {
    // Preenche o formulário uma vez por tarefa; sincronizações posteriores não apagam a edição em andamento.
    effect(() => {
      const task = this.task();
      untracked(() => {
        if (!task || this.loadedId === task.id) return;
        this.loadedId = task.id;
        this.form.reset({
          title: task.title, description: task.description ?? '', status: task.status,
          assigneeId: task.assigneeId ?? NONE, projectId: task.projectId ?? NONE, dueDate: dueDateToInput(task.dueDate),
        });
      });
    });
    effect(() => {
      if (this.locked()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });
  }

  protected async save(): Promise<void> {
    if (this.busy() || this.locked()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Informe um título com 3 a 180 caracteres.');
      return;
    }
    const value = this.form.getRawValue();
    const fields: TaskFields = {
      title: value.title.trim(),
      description: value.description.trim() || null,
      status: value.status,
      assigneeId: value.assigneeId || null,
      projectId: value.projectId || null,
      dueDate: dueDateFromInput(value.dueDate),
    };
    await this.run(async () => {
      const task = this.task();
      if (!task) {
        await this.sync.createTask(fields);
      } else {
        const current = fieldsOf(task);
        const changes = Object.fromEntries(TASK_FIELDS
          .filter((field) => !sameValue(field, fields[field], current[field]))
          .map((field) => [field, fields[field]])) as Partial<TaskFields>;
        if (Object.keys(changes).length > 0) await this.sync.updateTask(task.id, changes);
      }
      await this.router.navigate(['/tarefas']);
    });
  }

  protected async confirmDelete(): Promise<void> {
    const task = this.task();
    if (!task || this.busy() || this.locked()) return;
    const alert = await this.alerts.create({
      header: 'Excluir tarefa?',
      message: task.localOnly ? 'A tarefa ainda não foi enviada e será descartada.' : 'A exclusão será enviada na próxima sincronização.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Excluir', role: 'destructive',
          handler: () => void this.run(async () => {
            await this.sync.deleteTask(task.id);
            await this.router.navigate(['/tarefas']);
          }),
        },
      ],
    });
    await alert.present();
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (error: unknown) {
      this.error.set(error instanceof TaskLockedError ? error.message : 'Não foi possível salvar neste aparelho. Tente novamente.');
    } finally {
      this.busy.set(false);
    }
  }
}
