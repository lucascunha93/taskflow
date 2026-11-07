import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MembersService } from '../members/members.service';
import { ProjectsService } from '../projects/projects.service';
import { TaskDetailComponent } from '../tasks/task-detail.component';

@Component({
  selector: 'app-dashboard-task-detail',
  imports: [TaskDetailComponent],
  providers: [MembersService, ProjectsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-task-detail [taskId]="taskId()" (closed)="closed.emit()" (changed)="changed.emit($event)" />',
})
export class DashboardTaskDetailComponent {
  readonly taskId = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<string>();
}
