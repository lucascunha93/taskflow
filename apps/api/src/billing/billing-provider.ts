/**
 * Provedor de pagamento. Para usar um gateway real (Stripe, Mercado Pago),
 * implemente esta interface criando a sessão de pagamento no provedor e
 * confirme o checkout a partir do webhook assinado dele, chamando
 * `BillingService.settle`.
 */
export interface BillingProvider {
  readonly name: string;
  /** Inicia o pagamento e devolve o endereço para onde o usuário deve ir. */
  startCheckout(checkout: { id: string; organizationId: string; plan: string }): Promise<{ url: string }>;
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

/**
 * Checkout simulado: nenhum valor é cobrado. A "página de pagamento" é uma tela
 * do próprio TaskFlow, onde o proprietário aprova ou recusa o pagamento. Só é
 * habilitado com BILLING_PROVIDER=fake, e nunca com NODE_ENV=production.
 */
export class FakeBillingProvider implements BillingProvider {
  readonly name = 'fake';

  async startCheckout(checkout: { id: string }): Promise<{ url: string }> {
    return { url: `/plan/checkout/${checkout.id}` };
  }
}
