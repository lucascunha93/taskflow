import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { OrganizationsService } from '../organizations/organizations.service';
import { ActivityListComponent } from './activity-list.component';
import { Activity, ActivityPage } from './activity.models';
import { ActivityService } from './activity.service';

let nextFeedId = 0;

/**
 * Histórico com paginação. Sem `taskId`, mostra a atividade recente da
 * organização; com `taskId`, o histórico daquela tarefa.
 */
@Component({
  selector: 'app-activity-feed',
  imports: [ActivityListComponent],
  providers: [ActivityService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="feed" [attr.aria-labelledby]="headingId()">
      <div class="heading">
        <h3 [id]="headingId()">{{ heading() }}</h3>
        <button type="button" class="link-button" [disabled]="loading()" (click)="reloadNow()">Atualizar</button>
      </div>
      @if (loading()) {
        <p role="status">Carregando histórico…</p>
      } @else if (error()) {
        <p class="message" role="alert">{{ error() }}</p>
      } @else if (items().length === 0) {
        <p class="empty">{{ emptyText() }}</p>
      } @else {
        <app-activity-list [activities]="items()" [showTask]="!taskId()" (opened)="opened.emit($event)" />
        @if (nextCursor()) {
          <button type="button" class="tf-button tf-button--subtle" [disabled]="loadingMore()" (click)="loadMore()">
            {{ loadingMore() ? 'Carregando…' : 'Ver atividades anteriores' }}
          </button>
        }
      }
    </section>
  `,
  styles: `
    .feed { display: grid; gap: var(--space-4); }
    .heading { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
    h3 { margin: 0; font-size: 1.0625rem; }
    .empty { margin: 0; color: var(--color-text-secondary); }
    .message { margin: 0; padding: var(--space-3); border-radius: var(--radius-medium); background: #fff2f1; color: #8c252e; }
    .link-button { padding: 0; border: 0; background: none; color: var(--color-primary); cursor: pointer; font-weight: 600; }
    .feed > .tf-button { justify-self: start; }
  `,
})
export class ActivityFeedComponent {
  readonly taskId = input<string | null>(null);
  /** Incrementado pelo pai para recarregar, por exemplo após uma alteração. */
  readonly reload = input(0);
  readonly heading = input('Atividade recente');
  readonly emptyText = input('Nenhuma atividade registrada ainda.');
  readonly opened = output<string>();
  private readonly api = inject(ActivityService);
  private readonly organizations = inject(OrganizationsService);
  protected readonly items = signal<Activity[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal('');
  private readonly manualReload = signal(0);
  private requests = new Subscription();
  protected readonly headingId = signal(`activity-feed-${++nextFeedId}`);

  constructor() {
    effect((onCleanup) => {
      const taskId = this.taskId();
      this.reload();
      this.manualReload();
      this.organizations.active();
      this.requests.unsubscribe();
      this.requests = new Subscription();
      this.items.set([]);
      this.nextCursor.set(null);
      this.error.set('');
      this.loadingMore.set(false);
      this.loading.set(true);
      this.requests.add(this.fetch(taskId, null).subscribe({
        next: (page) => {
          this.items.set(page.data);
          this.nextCursor.set(page.nextCursor);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.message(error));
          this.loading.set(false);
        },
      }));
      onCleanup(() => this.requests.unsubscribe());
    });
  }

  protected reloadNow(): void {
    this.manualReload.update((value) => value + 1);
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.requests.add(this.fetch(this.taskId(), cursor).subscribe({
      next: (page) => {
        this.items.update((current) => [...current, ...page.data.filter((item) => !current.some((known) => known.id === item.id))]);
        this.nextCursor.set(page.nextCursor);
        this.loadingMore.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.message(error));
        this.loadingMore.set(false);
      },
    }));
  }

  private fetch(taskId: string | null, before: string | null): Observable<ActivityPage> {
    return taskId ? this.api.task(taskId, 20, before) : this.api.organization(10, before);
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 404) {
      return 'Histórico indisponível: a tarefa ou a organização não foi encontrada.';
    }
    return 'Não foi possível carregar o histórico. Tente atualizar.';
  }
}
