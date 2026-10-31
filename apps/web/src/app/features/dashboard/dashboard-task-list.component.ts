import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { statusLabel } from '../tasks/task.models';
import { DashboardSummary, DashboardTask } from './dashboard.models';

@Component({
  selector: 'app-dashboard-task-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-task-list.component.html',
  styleUrl: './dashboard-task-list.component.scss',
})
export class DashboardTaskListComponent {
  readonly title = input.required<string>();
  readonly emptyText = input.required<string>();
  readonly mode = input.required<'mine' | 'due' | 'recent'>();
  readonly tasks = input.required<DashboardTask[]>();
  readonly summary = input.required<DashboardSummary>();
  readonly opened = output<DashboardTask>();
  protected readonly statusLabel = statusLabel;

  protected deadlineLabel(task: DashboardTask): string {
    if (!task.dueDate || (task.status !== 'TODO' && task.status !== 'IN_PROGRESS')) return '';
    const deadline = Date.parse(task.dueDate);
    if (deadline < Date.parse(this.summary().asOf)) return 'Atrasada';
    return deadline <= Date.parse(this.summary().dueUntil) ? 'Vence em breve' : '';
  }
}
