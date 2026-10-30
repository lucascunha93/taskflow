import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrganizationMemberRole } from './dto/add-member.dto.js';
import { OrganizationsService } from './organizations.service.js';

describe('OrganizationsService', () => {
  const organizationId = 'organization-a';
  const requesterId = 'requester';
  const user = { id: 'member', name: 'Member', email: 'member@example.test' };
  const membership = { id: 'membership', role: 'MEMBER', createdAt: new Date() };
  let service: OrganizationsService;
  let transactionMembershipCreate: ReturnType<typeof vi.fn>;
  let prisma: {
    organization: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
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
      organization: { create: vi.fn(), findMany: vi.fn() },
      membership: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const module = await Test.createTestingModule({
      providers: [OrganizationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OrganizationsService);
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
    expect(prisma.membership.create).not.toHaveBeenCalled();
  });

  it('adds an existing user to the authorized organization', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.membership.create.mockResolvedValue(membership);
    const result = await service.addMember(organizationId, requesterId, {
      email: ' MEMBER@example.test ',
      role: OrganizationMemberRole.MEMBER,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: user.email } }));
    expect(prisma.membership.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { organizationId, userId: user.id, role: 'MEMBER' },
    }));
    expect(result).toEqual({ user, membership });
  });

  it('reports a duplicate membership even when a concurrent insert wins', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.membership.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    }));
    await expect(service.addMember(organizationId, requesterId, {
      email: user.email,
      role: OrganizationMemberRole.MEMBER,
    })).rejects.toMatchObject({ status: 409 });
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
});
