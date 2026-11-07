import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Activity, describeActivity } from './activity.models';

/** Lista de atividades. Com `showTask`, itens de tarefas existentes podem ser abertos. */
@Component({
  selector: 'app-activity-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="activity-list">
      @for (item of activities(); track item.id) {
        <li>
          <span class="dot" aria-hidden="true"></span>
          <div class="content">
            <p>
              <strong>{{ item.actor.name }}</strong>
              @if (showTask() && item.taskId) {
                {{ ' ' }}<button type="button" class="link-button" (click)="opened.emit(item.taskId)">{{ describe(item, true) }}</button>
              } @else {
                {{ ' ' + describe(item, showTask()) }}
              }
            </p>
            <time [attr.datetime]="item.createdAt">{{ item.createdAt | date: 'dd/MM/yyyy HH:mm' }}</time>
          </div>
        </li>
      }
    </ol>
  `,
  styles: `
    .activity-list { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
    li { display: flex; gap: var(--space-3); }
    .dot { width: 8px; height: 8px; margin-top: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--color-border-strong); }
    .content { min-width: 0; }
    p { margin: 0; overflow-wrap: anywhere; }
    time { color: var(--color-text-secondary); font-size: var(--font-size-small); }
    .link-button { padding: 0; border: 0; background: none; color: var(--color-primary); cursor: pointer; text-align: left; }
    .link-button:hover { text-decoration: underline; }
  `,
})
export class ActivityListComponent {
  readonly activities = input.required<readonly Activity[]>();
  readonly showTask = input(true);
  readonly opened = output<string>();

  protected describe(activity: Activity, includeTitle: boolean): string {
    return describeActivity(activity, includeTitle);
  }
}
