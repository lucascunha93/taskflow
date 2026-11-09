import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { OrganizationsService } from '../organizations/organizations.service';
import { formatBytes } from '../tasks/attachments/attachment.models';
import { BillingOverview, BillingService } from './billing.service';
import { PLAN_NAMES, PlanDefinition, PlanId, PlanOverview, planLimitMessage, usagePercent } from './plan.models';

interface UsageRow {
  label: string;
  used: string;
  limit: string;
  percent: number | null;
}

const NO_BILLING: BillingOverview = { provider: null, canManage: false, history: [] };

/** Plano da organização ativa, uso de cada recurso, comparação entre os planos e contratação. */
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
  private readonly router = inject(Router);
  private readonly billingApi = inject(BillingService);
  protected readonly organizations = inject(OrganizationsService);
  protected readonly overview = signal<PlanOverview | null>(null);
  protected readonly catalog = signal<PlanDefinition[]>([]);
  protected readonly billing = signal<BillingOverview>(NO_BILLING);
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly busy = signal(false);
  protected readonly actionError = signal('');
  protected readonly notice = signal(this.billingApi.takeNotice());
  protected readonly confirmingCancel = signal(false);
  private readonly reload = signal(0);
  protected readonly formatBytes = formatBytes;
  protected readonly planNames = PLAN_NAMES;

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

  /** O proprietário pode contratar quando a API tem um provedor de pagamento. */
  protected readonly canPurchase = computed(() => this.billing().canManage && this.billing().provider !== null);
  protected readonly simulated = computed(() => this.billing().provider === 'fake');

  constructor() {
    effect((onCleanup) => {
      const organizationId = this.organizations.active()?.id;
      this.reload();
      this.overview.set(null);
      this.confirmingCancel.set(false);
      if (!organizationId) return;
      this.status.set('loading');
      const id = encodeURIComponent(organizationId);
      const request = forkJoin({
        overview: this.http.get<PlanOverview>(`${this.base}/organizations/${id}/plan`),
        catalog: this.http.get<PlanDefinition[]>(`${this.base}/plans`),
        // Sem a contratação, a página continua mostrando plano e uso.
        billing: this.billingApi.overview(organizationId).pipe(catchError(() => of(NO_BILLING))),
      }).subscribe({
        next: ({ overview, catalog, billing }) => {
          this.overview.set(overview);
          this.catalog.set(catalog);
          this.billing.set(billing);
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

  protected purchase(plan: PlanId): void {
    const organizationId = this.organizations.active()?.id;
    if (!organizationId || plan === 'FREE' || this.busy()) return;
    this.busy.set(true);
    this.actionError.set('');
    this.notice.set('');
    this.billingApi.startCheckout(organizationId, plan).subscribe({
      next: (checkout) => {
        this.busy.set(false);
        const url = checkout.checkoutUrl ?? `/plan/checkout/${checkout.id}`;
        // O checkout de demonstração é uma tela do app; um gateway real usa endereço externo.
        if (url.startsWith('/')) void this.router.navigateByUrl(url);
        else window.location.assign(url);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.actionError.set(billingError(error, 'Não foi possível iniciar a contratação.'));
      },
    });
  }

  protected cancel(): void {
    const organizationId = this.organizations.active()?.id;
    if (!organizationId || this.busy()) return;
    this.busy.set(true);
    this.actionError.set('');
    this.billingApi.cancel(organizationId).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmingCancel.set(false);
        this.notice.set('A organização voltou ao plano Gratuito.');
        this.retry();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirmingCancel.set(false);
        this.actionError.set(billingError(error, 'Não foi possível voltar ao plano Gratuito.'));
      },
    });
  }
}

export function billingError(error: unknown, fallback: string): string {
  const limit = planLimitMessage(error);
  if (limit) return limit;
  const status = (error as { status?: number } | null)?.status;
  const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
  if (status === 409 && typeof message === 'string') return message;
  if (status === 403) return 'Somente o proprietário pode mudar o plano da organização.';
  if (status === 503) return 'A contratação de planos não está disponível neste ambiente.';
  return fallback;
}
