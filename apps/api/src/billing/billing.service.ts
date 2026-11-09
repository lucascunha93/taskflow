import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CheckoutStatus, OrganizationPlan, Prisma } from '../generated/prisma/client.js';
import { PLANS } from '../plans/plan-limits.js';
import { PlansService } from '../plans/plans.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BILLING_PROVIDER, type BillingProvider } from './billing-provider.js';

/** Tempo para concluir um pagamento iniciado. */
export const CHECKOUT_TTL_MS = 30 * 60_000;

const checkoutSelect = {
  id: true,
  organizationId: true,
  plan: true,
  status: true,
  provider: true,
  expiresAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.BillingCheckoutSelect;

type CheckoutRow = Prisma.BillingCheckoutGetPayload<{ select: typeof checkoutSelect }>;

const withPlanName = (checkout: CheckoutRow) => ({ ...checkout, planName: PLANS[checkout.plan].name });

/**
 * Contratação de planos. Só o proprietário (OWNER) muda o plano; administradores
 * consultam o histórico. O plano pago só é aplicado quando o provedor confirma
 * o pagamento, e a confirmação é idempotente. Voltar ao Gratuito é imediato,
 * sem reembolso proporcional.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    @Optional() @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider | null,
  ) {}

  /** Estado da contratação para a tela de plano. */
  async overview(organizationId: string, userId: string) {
    const role = await this.role(organizationId, userId);
    const canManage = role === 'OWNER';
    const history = role === 'MEMBER' ? [] : await this.prisma.planChange.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: { id: true, fromPlan: true, toPlan: true, createdAt: true, checkoutId: true, actor: { select: { id: true, name: true } } },
    });
    return { provider: this.provider?.name ?? null, canManage, history };
  }

  async startCheckout(organizationId: string, userId: string, plan: OrganizationPlan) {
    const provider = this.requireProvider();
    await this.assertOwner(organizationId, userId);
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plan: true } });
    if (organization.plan === plan) throw new ConflictException('A organização já está nesse plano.');

    const checkout = await this.prisma.$transaction(async (tx) => {
      // Um pedido novo substitui o anterior ainda não pago.
      await tx.billingCheckout.updateMany({ where: { organizationId, status: 'PENDING' }, data: { status: 'CANCELED' } });
      return tx.billingCheckout.create({
        data: {
          organizationId, requestedById: userId, plan, provider: provider.name,
          expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
        },
        select: checkoutSelect,
      });
    });
    const { url } = await provider.startCheckout(checkout);
    return { ...withPlanName(checkout), checkoutUrl: url };
  }

  async getCheckout(organizationId: string, checkoutId: string, userId: string) {
    await this.assertOwner(organizationId, userId);
    return withPlanName(await this.expireIfDue(await this.find(checkoutId, organizationId)));
  }

  /**
   * Resultado do pagamento simulado, informado pelo proprietário na tela de
   * demonstração. Com um gateway real, esta etapa vem do webhook do provedor.
   */
  async completeFake(checkoutId: string, userId: string, outcome: 'approve' | 'decline') {
    if (this.provider?.name !== 'fake') throw new NotFoundException('Checkout não encontrado.');
    const checkout = await this.prisma.billingCheckout.findUnique({ where: { id: checkoutId }, select: checkoutSelect });
    if (!checkout) throw new NotFoundException('Checkout não encontrado.');
    await this.assertOwner(checkout.organizationId, userId);
    return this.settle(checkoutId, outcome === 'approve' ? 'PAID' : 'FAILED');
  }

  /** Conclui um checkout pendente; reprocessar o mesmo resultado não muda nada. */
  async settle(checkoutId: string, result: Extract<CheckoutStatus, 'PAID' | 'FAILED'>) {
    const settled = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const changed = await tx.billingCheckout.updateManyAndReturn({
        where: { id: checkoutId, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: result, completedAt: now },
        select: { ...checkoutSelect, requestedById: true },
      });
      if (changed.length === 0) return null;
      const checkout = changed[0];
      if (result === 'PAID') {
        const from = await this.plans.lock(tx, checkout.organizationId);
        if (from !== checkout.plan) {
          await tx.organization.update({ where: { id: checkout.organizationId }, data: { plan: checkout.plan, planChangedAt: now } });
          await tx.planChange.create({
            data: { organizationId: checkout.organizationId, fromPlan: from, toPlan: checkout.plan, actorId: checkout.requestedById, checkoutId },
          });
        }
      }
      const { requestedById: _requestedBy, ...rest } = checkout;
      return rest;
    });
    if (settled) return withPlanName(settled);

    const current = await this.expireIfDue(await this.find(checkoutId));
    if (current.status === result) return withPlanName(current); // reprocessamento
    if (current.status === 'EXPIRED') throw new ConflictException('O prazo deste pagamento terminou. Inicie a contratação novamente.');
    throw new ConflictException('Este pagamento já foi concluído ou cancelado.');
  }

  /** Volta ao plano Gratuito imediatamente. */
  async cancel(organizationId: string, userId: string) {
    await this.assertOwner(organizationId, userId);
    return this.prisma.$transaction(async (tx) => {
      const from = await this.plans.lock(tx, organizationId);
      if (from === 'FREE') throw new ConflictException('A organização já está no plano Gratuito.');
      // O proprietário precisa ter vaga para mais uma organização gratuita.
      await this.plans.assertCanOwnFreeOrganization(tx, userId);
      await tx.organization.update({ where: { id: organizationId }, data: { plan: 'FREE', planChangedAt: new Date() } });
      await tx.billingCheckout.updateMany({ where: { organizationId, status: 'PENDING' }, data: { status: 'CANCELED' } });
      await tx.planChange.create({ data: { organizationId, fromPlan: from, toPlan: 'FREE', actorId: userId } });
      return { plan: 'FREE' as const, name: PLANS.FREE.name };
    });
  }

  private requireProvider(): BillingProvider {
    if (!this.provider) throw new ServiceUnavailableException('A contratação de planos não está disponível.');
    return this.provider;
  }

  private async find(checkoutId: string, organizationId?: string): Promise<CheckoutRow> {
    const checkout = await this.prisma.billingCheckout.findFirst({
      where: { id: checkoutId, ...(organizationId ? { organizationId } : {}) },
      select: checkoutSelect,
    });
    if (!checkout) throw new NotFoundException('Checkout não encontrado.');
    return checkout;
  }

  private async expireIfDue(checkout: CheckoutRow): Promise<CheckoutRow> {
    if (checkout.status !== 'PENDING' || checkout.expiresAt > new Date()) return checkout;
    await this.prisma.billingCheckout.updateMany({ where: { id: checkout.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return { ...checkout, status: 'EXPIRED' };
  }

  private async role(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Organização não encontrada.');
    return membership.role;
  }

  private async assertOwner(organizationId: string, userId: string): Promise<void> {
    if ((await this.role(organizationId, userId)) !== 'OWNER') {
      throw new ForbiddenException('Somente o proprietário pode mudar o plano da organização.');
    }
  }
}
