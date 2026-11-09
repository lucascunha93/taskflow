import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlanLimitException } from '../plans/plan-limits.js';
import { PlansService } from '../plans/plans.service.js';
import { OrganizationMemberRole } from './dto/add-member.dto.js';
import { OrganizationsService } from './organizations.service.js';

describe('OrganizationsService', () => {
  const organizationId = 'organization-a';
  const requesterId = 'requester';
  const user = { id: 'member', name: 'Member', email: 'member@example.test' };
  const membership = { id: 'membership', role: 'MEMBER', createdAt: new Date() };
  let service: OrganizationsService;
  let plans: { assertCanCreate: ReturnType<typeof vi.fn>; assertCanOwnFreeOrganization: ReturnType<typeof vi.fn> };
  let transactionMembershipCreate: ReturnType<typeof vi.fn>;
  let prisma: {
    organization: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    membership: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const tx = {
      organization: {
        create: vi.fn(({ data }: { data: { name: string; slug: string } }) =>
          Promise.resolve({ id: organizationId, ...data, createdAt: new Date() }),
        ),
      },
      membership: { create: vi.fn().mockResolvedValue(membership) },
    };
    transactionMembershipCreate = tx.membership.create;
    prisma = {
      organization: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      membership: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [OrganizationsService, { provide: PlansService, useValue: { assertCanCreate: vi.fn(), assertCanStore: vi.fn(), assertCanOwnFreeOrganization: vi.fn() } }, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OrganizationsService);
    plans = module.get(PlansService);
  });

  it('creates an owner membership and a slug no longer than 80 characters', async () => {
    const result = await service.create(requesterId, { name: 'A'.repeat(120) });
    expect(result.slug).toMatch(/^a{71}-[0-9a-f]{8}$/);
    expect(result.slug).toHaveLength(80);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transactionMembershipCreate).toHaveBeenCalledWith({
      data: { organizationId, userId: requesterId, role: 'OWNER' },
    });
  });

  it('uses a nonempty slug for names without ASCII characters', async () => {
    const result = await service.create(requesterId, { name: '東京' });
    expect(result.slug).toMatch(/^organization-[0-9a-f]{8}$/);
  });

  it('restricts organization listing to the requesting user', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    await service.findAllByUser(requesterId);
    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { memberships: { some: { userId: requesterId } } } }),
    );
  });

  it('hides an organization from nonmembers before looking up another user', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.addMember(organizationId, requesterId, {
      email: user.email,
      role: OrganizationMemberRole.MEMBER,
    })).rejects.toMatchObject({ status: 404 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    await expect(service.findMembers(organizationId, requesterId)).rejects.toMatchObject({ status: 404 });
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });

  it('does not let a member add another user', async () => {
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    await expect(service.addMember(organizationId, requesterId, {
      email: user.email,
      role: OrganizationMemberRole.MEMBER,
    })).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not let an admin add an admin', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.addMember(organizationId, requesterId, {
      email: user.email,
      role: OrganizationMemberRole.ADMIN,
    })).rejects.toMatchObject({ status: 403 });
    expect(transactionMembershipCreate).not.toHaveBeenCalled();
  });

  it('adds an existing user to the authorized organization', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(user);
    transactionMembershipCreate.mockResolvedValue(membership);
    const result = await service.addMember(organizationId, requesterId, {
      email: ' MEMBER@example.test ',
      role: OrganizationMemberRole.MEMBER,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: user.email } }));
    expect(transactionMembershipCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { organizationId, userId: user.id, role: 'MEMBER' },
    }));
    expect(result).toEqual({ user, membership });
  });

  it('reports a duplicate membership even when a concurrent insert wins', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(user);
    transactionMembershipCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    }));
    await expect(service.addMember(organizationId, requesterId, {
      email: user.email,
      role: OrganizationMemberRole.MEMBER,
    })).rejects.toMatchObject({ status: 409 });
  });

  it('checks plan limits inside the transactions that create organizations and members', async () => {
    await service.create(requesterId, { name: 'Equipe' });
    expect(plans.assertCanOwnFreeOrganization).toHaveBeenCalledWith(expect.anything(), requesterId);

    plans.assertCanOwnFreeOrganization.mockRejectedValueOnce(new PlanLimitException('freeOrganizations', 'FREE', 'limite'));
    transactionMembershipCreate.mockClear();
    await expect(service.create(requesterId, { name: 'Outra' })).rejects.toMatchObject({ status: 403 });
    expect(transactionMembershipCreate).not.toHaveBeenCalled();

    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(user);
    plans.assertCanCreate.mockRejectedValueOnce(new PlanLimitException('members', 'FREE', 'limite'));
    await expect(service.addMember(organizationId, requesterId, {
      email: user.email,
      role: OrganizationMemberRole.MEMBER,
    })).rejects.toMatchObject({ status: 403, response: { code: 'PLAN_LIMIT_REACHED', limit: 'members' } });
    expect(plans.assertCanCreate).toHaveBeenCalledWith(expect.anything(), organizationId, 'members');
    expect(transactionMembershipCreate).not.toHaveBeenCalled();
  });

  it('only lists members of the requested organization after checking membership', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.membership.findMany.mockResolvedValue([]);
    await service.findMembers(organizationId, requesterId);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_userId: { organizationId, userId: requesterId } },
    }));
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId },
    }));
  });

  describe('update', () => {
    const organization = { id: organizationId, name: 'Novo nome', slug: 'slug-a', createdAt: new Date() };

    it.each(['OWNER', 'ADMIN'] as const)('lets an %s rename the organization in one conditional write', async (role) => {
      prisma.membership.findUnique.mockResolvedValue({ role });
      prisma.organization.update.mockResolvedValue(organization);
      await expect(service.update(organizationId, requesterId, { name: ' Novo nome ' }))
        .resolves.toEqual({ ...organization, role });
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: {
          id: organizationId,
          memberships: { some: { userId: requesterId, role: { in: ['OWNER', 'ADMIN'] } } },
        },
        data: { name: 'Novo nome' },
        select: { id: true, name: true, slug: true, plan: true, createdAt: true },
      });
    });

    it('returns 404 for a non-member and 403 for a MEMBER without writing', async () => {
      prisma.membership.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ role: 'MEMBER' });
      await expect(service.update(organizationId, requesterId, { name: 'Nome' }))
        .rejects.toMatchObject({ status: 404 });
      await expect(service.update(organizationId, requesterId, { name: 'Nome' }))
        .rejects.toMatchObject({ status: 403 });
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the membership disappears before the conditional write', async () => {
      prisma.membership.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.organization.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'test',
      }));
      await expect(service.update(organizationId, requesterId, { name: 'Nome' }))
        .rejects.toMatchObject({ status: 404 });
    });
  });
});
