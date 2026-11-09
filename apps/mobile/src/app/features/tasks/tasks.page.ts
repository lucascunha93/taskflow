import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonBadge, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonLabel, IonList,
  IonNote, IonRefresher, IonRefresherContent, IonSearchbar, IonSegment, IonSegmentButton, IonTitle, IonToolbar,
  type RefresherCustomEvent,
} from '@ionic/angular';
import { LogoutService } from '../../core/logout.service';
import { SyncService, SyncState } from '../../offline/sync.service';
import { TaskStatus, TaskSyncState, TaskView, statusLabel } from '../../offline/task.models';

type Filter = 'ALL' | TaskStatus;

const SYNC_BADGES: Record<Exclude<TaskSyncState, 'synced'>, { label: string; color: string }> = {
  pending: { label: 'Não enviada', color: 'medium' },
  conflict: { label: 'Conflito', color: 'warning' },
  failed: { label: 'Recusada', color: 'danger' },
};

/** Texto do estado da sincronização exibido no topo da lista. */
export function syncSummary(state: SyncState, pending: number, lastSyncAt: string | null): { icon: string; text: string } {
  const queued = pending > 0 ? ` · ${pending} alteração(ões) na fila` : '';
  if (state === 'syncing') return { icon: 'sync-outline', text: `Sincronizando…${queued}` };
  if (state === 'offline') return { icon: 'cloud-offline-outline', text: `Sem conexão${queued}` };
  if (state === 'retrying') return { icon: 'time-outline', text: `Servidor indisponível, nova tentativa em breve${queued}` };
  if (state === 'signed-out') return { icon: 'alert-circle-outline', text: `Sessão expirada${queued}` };
  if (pending > 0) return { icon: 'time-outline', text: `${pending} alteração(ões) na fila` };
  if (!lastSyncAt) return { icon: 'sync-outline', text: 'Ainda não sincronizado' };
  const time = new Date(lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return { icon: 'checkmark-circle-outline', text: `Sincronizado às ${time}` };
}

@Component({
  selector: 'app-tasks',
  imports: [
    DatePipe, RouterLink, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonRefresher,
    IonRefresherContent, IonSearchbar, IonSegment, IonSegmentButton, IonList, IonItem, IonLabel, IonNote, IonBadge, IonFab,
    IonFabButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tasks.page.html',
  styles: [`
    .sync-bar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 0.85rem; color: var(--ion-color-medium-shade); }
    .issues { margin: 8px 16px; }
    ion-badge { margin-left: 4px; }
    .meta { display: block; margin-top: 2px; font-size: 0.8rem; }
  `],
})
export class TasksPage {
  protected readonly sync = inject(SyncService);
  protected readonly logout = inject(LogoutService);
  private readonly router = inject(Router);
  protected readonly filter = signal<Filter>('ALL');
  protected readonly search = signal('');
  protected readonly badges = SYNC_BADGES;
  protected readonly statusLabel = statusLabel;

  protected readonly summary = computed(() => syncSummary(this.sync.state(), this.sync.pendingCount(), this.sync.lastSyncAt()));
  private readonly memberNames = computed(() => new Map(this.sync.members().map((member) => [member.id, member.name])));

  protected readonly visible = computed(() => {
    const filter = this.filter();
    const term = this.search().trim().toLocaleLowerCase('pt-BR');
    return this.sync.tasks().filter((task) =>
      (filter === 'ALL' || task.status === filter) && (!term || task.title.toLocaleLowerCase('pt-BR').includes(term)));
  });

  constructor() {
    // Sem organização escolhida: abre a lista de organizações.
    effect(() => {
      if (!this.sync.activeOrganization() && this.sync.organizations().length > 1) {
        void this.router.navigate(['/organizacoes']);
      }
    });
  }

  protected assignee(task: TaskView): string | null {
    return task.assigneeId ? this.memberNames().get(task.assigneeId) ?? 'Responsável' : null;
  }

  protected setFilter(value: unknown): void {
    this.filter.set((value as Filter) ?? 'ALL');
  }

  protected async refresh(event: RefresherCustomEvent): Promise<void> {
    await this.sync.sync();
    await event.target.complete();
  }
}
