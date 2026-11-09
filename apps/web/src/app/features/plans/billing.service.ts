import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { PlanId } from './plan.models';

export type CheckoutStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'EXPIRED';

export interface Checkout {
  id: string;
  organizationId: string;
  plan: PlanId;
  planName: string;
  status: CheckoutStatus;
  provider: string;
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
  checkoutUrl?: string;
}

export interface PlanChange {
  id: string;
  fromPlan: PlanId;
  toPlan: PlanId;
  createdAt: string;
  checkoutId: string | null;
  actor: { id: string; name: string } | null;
}

export interface BillingOverview {
  /** Provedor de pagamento configurado na API; `null` sem contratação online. */
  provider: string | null;
  /** Somente o proprietário muda o plano. */
  canManage: boolean;
  history: PlanChange[];
}

/** Contratação de planos da organização. */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL).replace(/\/+$/, '');
  private notice = '';

  /** Mensagem para a tela de plano depois de concluir um checkout. */
  setNotice(message: string): void {
    this.notice = message;
  }

  takeNotice(): string {
    const message = this.notice;
    this.notice = '';
    return message;
  }

  overview(organizationId: string): Observable<BillingOverview> {
    return this.http.get<BillingOverview>(this.url(organizationId));
  }

  startCheckout(organizationId: string, plan: Exclude<PlanId, 'FREE'>): Observable<Checkout> {
    return this.http.post<Checkout>(`${this.url(organizationId)}/checkouts`, { plan });
  }

  checkout(organizationId: string, checkoutId: string): Observable<Checkout> {
    return this.http.get<Checkout>(`${this.url(organizationId)}/checkouts/${encodeURIComponent(checkoutId)}`);
  }

  cancel(organizationId: string): Observable<{ plan: PlanId; name: string }> {
    return this.http.post<{ plan: PlanId; name: string }>(`${this.url(organizationId)}/cancel`, {});
  }

  /** Simula a resposta do gateway (somente com o provedor de demonstração). */
  completeFake(checkoutId: string, outcome: 'approve' | 'decline'): Observable<Checkout> {
    return this.http.post<Checkout>(`${this.base}/billing/fake/checkouts/${encodeURIComponent(checkoutId)}/complete`, { outcome });
  }

  private url(organizationId: string): string {
    return `${this.base}/organizations/${encodeURIComponent(organizationId)}/billing`;
  }
}
