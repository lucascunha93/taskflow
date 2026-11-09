import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { OrganizationsService } from '../organizations/organizations.service';
import { formatBytes } from '../tasks/attachments/attachment.models';
import { PlanDefinition, PlanOverview, usagePercent } from './plan.models';

interface UsageRow {
  label: string;
  used: string;
  limit: string;
  percent: number | null;
}

/** Plano da organização ativa, uso de cada recurso e comparação entre os planos. */
@Component({
  selector: 'app-plan-page',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-page.component.html',
  styleUrls: ['../organizations/organization-page.scss', './plan-page.component.scss'],
})
export class PlanPageComponent {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  protected readonly organizations = inject(OrganizationsService);
  protected readonly overview = signal<PlanOverview | null>(null);
  protected readonly catalog = signal<PlanDefinition[]>([]);
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly reload = signal(0);
  protected readonly formatBytes = formatBytes;

  protected readonly rows = computed<UsageRow[]>(() => {
    const overview = this.overview();
    if (!overview) return [];
    const { usage, limits } = overview;
    const count = (used: number, limit: number | null, label: string): UsageRow => ({
      label, used: used.toLocaleString('pt-BR'), limit: limit === null ? 'Ilimitado' : limit.toLocaleString('pt-BR'),
      percent: usagePercent(used, limit),
    });
    return [
      count(usage.members, limits.members, 'Membros'),
      count(usage.projects, limits.projects, 'Projetos'),
      count(usage.tasks, limits.tasks, 'Tarefas'),
      {
        label: 'Armazenamento de anexos', used: formatBytes(usage.storageBytes), limit: formatBytes(limits.storageBytes),
        percent: usagePercent(usage.storageBytes, limits.storageBytes),
      },
    ];
  });

  constructor() {
    effect((onCleanup) => {
      const organizationId = this.organizations.active()?.id;
      this.reload();
      this.overview.set(null);
      if (!organizationId) return;
      this.status.set('loading');
      const id = encodeURIComponent(organizationId);
      const request = forkJoin({
        overview: this.http.get<PlanOverview>(`${this.base}/organizations/${id}/plan`),
        catalog: this.http.get<PlanDefinition[]>(`${this.base}/plans`),
      }).subscribe({
        next: ({ overview, catalog }) => {
          this.overview.set(overview);
          this.catalog.set(catalog);
          this.status.set('ready');
        },
        error: () => this.status.set('error'),
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  protected limit(value: number | null): string {
    return value === null ? 'Ilimitado' : value.toLocaleString('pt-BR');
  }
}
