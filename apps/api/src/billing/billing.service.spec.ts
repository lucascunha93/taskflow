import { Test } from '@nestjs/testing';
import { PlansService } from '../plans/plans.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BILLING_PROVIDER, FakeBillingProvider } from './billing-provider.js';
import { BillingService } from './billing.service.js';

describe('BillingService', () => {
  const organizationId = '00000000-0000-4000-8000-000000000001';
  const checkoutId = '00000000-0000-4000-8000-000000000002';
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    organization: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
    billingCheckout: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    planChange: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };

  async function service(provider: unknown) {
    prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'FREE' }) },
      billingCheckout: {
        findUnique: vi.fn().mockResolvedValue({ id: checkoutId, organizationId, plan: 'PRO', status: 'PENDING' }),
        create: vi.fn().mockResolvedValue({ id: checkoutId, organizationId, plan: 'PRO', status: 'PENDING', provider: 'fake' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      planChange: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }]) },
      $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const module = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlansService, useValue: { lock: vi.fn(), assertCanOwnFreeOrganization: vi.fn() } },
        { provide: BILLING_PROVIDER, useValue: provider },
      ],
    }).compile();
    return module.get(BillingService);
  }

  it('is unavailable without a configured provider', async () => {
    const billing = await service(null);
    await expect(billing.startCheckout(organizationId, 'owner', 'PRO')).rejects.toMatchObject({ status: 503 });
    await expect(billing.completeFake(checkoutId, 'owner', 'approve')).rejects.toMatchObject({ status: 404 });
    await expect(billing.overview(organizationId, 'owner')).resolves.toMatchObject({ provider: null, canManage: true });
  });

  it('lets only the owner start a checkout, for a plan different from the current one', async () => {
    const billing = await service(new FakeBillingProvider());
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
    await expect(billing.startCheckout(organizationId, 'admin', 'PRO')).rejects.toMatchObject({ status: 403 });
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(billing.startCheckout(organizationId, 'stranger', 'PRO')).rejects.toMatchObject({ status: 404 });

    prisma.organization.findUniqueOrThrow.mockResolvedValueOnce({ plan: 'PRO' });
    await expect(billing.startCheckout(organizationId, 'owner', 'PRO')).rejects.toMatchObject({ status: 409 });

    await expect(billing.startCheckout(organizationId, 'owner', 'PRO')).resolves.toMatchObject({
      id: checkoutId, planName: 'Profissional', checkoutUrl: `/plan/checkout/${checkoutId}`,
    });
    // O pedido novo cancela o anterior ainda pendente.
    expect(prisma.billingCheckout.updateMany).toHaveBeenCalledWith({
      where: { organizationId, status: 'PENDING' }, data: { status: 'CANCELED' },
    });
  });

  it('shows the plan history to owners and admins but not to members', async () => {
    const billing = await service(new FakeBillingProvider());
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
    await expect(billing.overview(organizationId, 'admin')).resolves.toMatchObject({ provider: 'fake', canManage: false, history: [{ id: 'c1' }] });
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'MEMBER' });
    await expect(billing.overview(organizationId, 'member')).resolves.toMatchObject({ canManage: false, history: [] });
  });

  it('only lets the owner of the checkout organization simulate the payment', async () => {
    const billing = await service(new FakeBillingProvider());
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'MEMBER' });
    await expect(billing.completeFake(checkoutId, 'member', 'approve')).rejects.toMatchObject({ status: 403 });
    prisma.billingCheckout.findUnique.mockResolvedValueOnce(null);
    await expect(billing.completeFake(checkoutId, 'owner', 'approve')).rejects.toMatchObject({ status: 404 });
  });
});
