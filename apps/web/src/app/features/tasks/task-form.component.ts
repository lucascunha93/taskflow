import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MembersService } from '../members/members.service';
import { Member } from '../members/member.models';
import { CreateTask, TASK_STATUSES, Task, TaskStatus, UpdateTask } from './task.models';

function titleValidator(control: AbstractControl<string>): ValidationErrors | null {
  const length = control.value.trim().length;
  return length >= 3 && length <= 180 ? null : { titleLength: true };
}

function localDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-form.component.html',
  styleUrl: './task-form.component.scss',
})
export class TaskFormComponent {
  readonly task = input<Task | null>(null);
  readonly busy = input(false);
  readonly locked = input(false);
  readonly submitted = output<CreateTask | UpdateTask>();
  readonly cancelled = output<void>();
  protected readonly members = inject(MembersService);
  protected readonly statuses = TASK_STATUSES;
  protected readonly isCurrentAssignee = (member: Member): boolean => member.user.id === this.task()?.assigneeId;
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group({
    title: ['', titleValidator],
    description: ['', Validators.maxLength(5000)],
    status: this.fb.control<TaskStatus>('TODO', Validators.required),
    assigneeId: [''],
    dueDate: [''],
  });

  constructor() {
    effect(() => {
      const task = this.task();
      this.form.reset({
        title: task?.title ?? '',
        description: task?.description ?? '',
        status: task?.status ?? 'TODO',
        assigneeId: task?.assigneeId ?? '',
        dueDate: localDate(task?.dueDate ?? null),
      });
    });
  }

  protected submit(): void {
    if (this.busy() || this.locked()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const date = value.dueDate ? new Date(value.dueDate) : null;
    if (date && Number.isNaN(date.getTime())) {
      this.form.controls.dueDate.setErrors({ date: true });
      this.form.controls.dueDate.markAsTouched();
      return;
    }
    const title = value.title.trim();
    const description = value.description.trim();
    const task = this.task();
    if (!task) {
      const data: CreateTask = { title, status: value.status };
      if (description) data.description = description;
      if (value.assigneeId) data.assigneeId = value.assigneeId;
      if (date) data.dueDate = date.toISOString();
      this.submitted.emit(data);
      return;
    }
    const data: UpdateTask = { version: task.version };
    if (title !== task.title) data.title = title;
    if ((description || null) !== task.description) data.description = description || null;
    if (value.status !== task.status) data.status = value.status;
    if ((value.assigneeId || null) !== task.assigneeId) data.assigneeId = value.assigneeId || null;
    if (value.dueDate !== localDate(task.dueDate)) data.dueDate = date?.toISOString() ?? null;
    this.submitted.emit(data);
  }
}
