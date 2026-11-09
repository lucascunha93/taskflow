import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { OrganizationsService } from '../organizations/organizations.service';
import { BillingService, Checkout, CheckoutStatus } from './billing.service';
import { billingError } from './plan-page.component';

const STATUS_TEXT: Record<CheckoutStatus, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pagamento aprovado',
  FAILED: 'Pagamento recusado',
  CANCELED: 'Substituído por um pedido mais recente',
  EXPIRED: 'Prazo encerrado',
};

/**
 * Página de pagamento de demonstração. Faz o papel do gateway: o proprietário
 * aprova ou recusa, e a API aplica o plano somente após a aprovação.
 */
@Component({
  selector: 'app-checkout-page',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../organizations/organization-page.scss'],
  styles: [`
    .demo { padding: var(--space-3); border-radius: var(--radius-medium); background: #fff7e6; color: #7a4b00; }
    .summary { margin: var(--space-6) 0; }
    .buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-6); }
  `],
  template: `
    <section class="page">
      <p class="eyebrow">CONTRATAÇÃO</p>
      <h1>Pagamento</h1>
      <p class="demo" role="note"><strong>Ambiente de demonstração.</strong> Nenhum valor é cobrado e nenhum dado de cartão é pedido.</p>

      @if (error()) { <p class="message" role="alert">{{ error() }}</p> }

      @if (checkout(); as item) {
        <dl class="summary details">
          <div><dt>Organização</dt><dd>{{ organizations.active()?.name }}</dd></div>
          <div><dt>Plano</dt><dd>{{ item.planName }}</dd></div>
          <div><dt>Situação</dt><dd role="status">{{ statusText[item.status] }}</dd></div>
          @if (item.status === 'PENDING') {
            <div><dt>Válido até</dt><dd>{{ item.expiresAt | date: 'HH:mm' }}</dd></div>
          }
        </dl>
        <div class="buttons">
          @if (item.status === 'PENDING') {
            <button type="button" class="tf-button" [disabled]="busy()" (click)="complete('approve')">Simular pagamento aprovado</button>
            <button type="button" class="tf-button tf-button--subtle" [disabled]="busy()" (click)="complete('decline')">Simular recusa</button>
          }
          <a class="tf-button tf-button--subtle" routerLink="/plan">Voltar ao plano</a>
        </div>
      } @else if (!error()) {
        <p role="status">Carregando pagamento…</p>
      }
    </section>
  `,
})
export class CheckoutPageComponent {
  private readonly checkoutId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('checkoutId') ?? '')),
    { initialValue: '' },
  );
  protected readonly organizations = inject(OrganizationsService);
  private readonly billing = inject(BillingService);
  private readonly router = inject(Router);
  protected readonly checkout = signal<Checkout | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly statusText = STATUS_TEXT;

  constructor() {
    effect((onCleanup) => {
      const organizationId = this.organizations.active()?.id;
      const checkoutId = this.checkoutId();
      if (!organizationId || !checkoutId) return;
      const request = this.billing.checkout(organizationId, checkoutId).subscribe({
        next: (checkout) => this.checkout.set(checkout),
        error: (error: unknown) => this.error.set((error as { status?: number }).status === 404
          ? 'Pagamento não encontrado nesta organização.'
          : billingError(error, 'Não foi possível carregar o pagamento.')),
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  protected complete(outcome: 'approve' | 'decline'): void {
    const checkout = this.checkout();
    if (!checkout || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.billing.completeFake(checkout.id, outcome).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.checkout.set({ ...checkout, ...result });
        if (result.status === 'PAID') {
          this.billing.setNotice(`Pagamento aprovado. A organização agora está no plano ${result.planName}.`);
          void this.router.navigate(['/plan']);
        }
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(billingError(error, 'Não foi possível concluir o pagamento.'));
      },
    });
  }
}
