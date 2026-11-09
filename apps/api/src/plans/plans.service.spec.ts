import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { FREE_ORGANIZATIONS_PER_OWNER, MAX_FILE_BYTES, PLANS } from './plan-limits.js';
import { PlansService } from './plans.service.js';

const MB = 1024 * 1024;

describe('PlansService', () => {
  const organizationId = '00000000-0000-4000-8000-000000000001';
  let service: PlansService;
  let prisma: {
    organization: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    membership: { count: ReturnType<typeof vi.fn> };
    project: { count: ReturnType<typeof vi.fn> };
    task: { count: ReturnType<typeof vi.fn> };
    taskAttachment: { aggregate: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };
  // A transação dos serviços é o próprio stub: as consultas são as mesmas.
  const tx = () => prisma as never;

  beforeEach(async () => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ plan: 'FREE', planChangedAt: null }),
        findUnique: vi.fn().mockResolvedValue({ plan: 'FREE' }),
      },
      membership: { count: vi.fn().mockResolvedValue(1) },
      project: { count: vi.fn().mockResolvedValue(0) },
      task: { count: vi.fn().mockResolvedValue(0) },
      taskAttachment: { aggregate: vi.fn().mockResolvedValue({ _sum: { size: null } }) },
      $queryRaw: vi.fn().mockResolvedValue([{ plan: 'FREE' }]),
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const module = await Test.createTestingModule({
      providers: [PlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PlansService);
  });

  it('keeps the upload ceiling equal to the largest plan file size', () => {
    expect(MAX_FILE_BYTES).toBe(Math.max(...Object.values(PLANS).map((plan) => plan.limits.maxFileBytes)));
    expect(service.catalog().map((plan) => plan.id)).toEqual(['FREE', 'PRO', 'BUSINESS']);
  });

  it('returns plan, limits and usage only to members', async () => {
    prisma.membership.count.mockResolvedValue(3);
    prisma.taskAttachment.aggregate.mockResolvedValue({ _sum: { size: 2048 } });
    await expect(service.overview(organizationId, 'user')).resolves.toMatchObject({
      plan: 'FREE', name: 'Gratuito', limits: PLANS.FREE.limits,
      usage: { members: 3, projects: 0, tasks: 0, storageBytes: 2048 },
    });
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: organizationId, memberships: { some: { userId: 'user' } } },
    }));
    prisma.organization.findFirst.mockResolvedValue(null);
    await expect(service.overview(organizationId, 'stranger')).rejects.toMatchObject({ status: 404 });
  });

  it('locks the organization and refuses a resource at the plan limit', async () => {
    prisma.membership.count.mockResolvedValue(PLANS.FREE.limits.members! - 1);
    await expect(service.assertCanCreate(tx(), organizationId, 'members')).resolves.toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(String((prisma.$queryRaw.mock.calls[0][0] as string[]).join('?'))).toContain('FOR NO KEY UPDATE');

    prisma.membership.count.mockResolvedValue(PLANS.FREE.limits.members);
    await expect(service.assertCanCreate(tx(), organizationId, 'members')).rejects.toMatchObject({
      status: 403,
      response: { code: 'PLAN_LIMIT_REACHED', limit: 'members', plan: 'FREE' },
    });
  });

  it('does not count resources without a numeric limit', async () => {
    prisma.$queryRaw.mockResolvedValue([{ plan: 'PRO' }]);
    await service.assertCanCreate(tx(), organizationId, 'projects');
    await service.assertCanCreate(tx(), organizationId, 'tasks');
    expect(prisma.project.count).not.toHaveBeenCalled();
    expect(prisma.task.count).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization disappeared', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.assertCanCreate(tx(), organizationId, 'tasks')).rejects.toMatchObject({ status: 404 });
  });

  it('enforces file size and storage quota of the plan', async () => {
    await expect(service.assertCanStore(organizationId, 10 * MB)).resolves.toBeUndefined();
    await expect(service.assertCanStore(organizationId, 10 * MB + 1)).rejects.toMatchObject({
      response: { code: 'PLAN_LIMIT_REACHED', limit: 'fileSize' },
    });
    prisma.taskAttachment.aggregate.mockResolvedValue({ _sum: { size: PLANS.FREE.limits.storageBytes - 100 } });
    await expect(service.assertCanStore(organizationId, 100)).resolves.toBeUndefined();
    await expect(service.assertCanStore(organizationId, 101, tx())).rejects.toMatchObject({
      response: { code: 'PLAN_LIMIT_REACHED', limit: 'storage' },
    });
    // Com transação, a cota é confirmada com a organização travada.
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();

    prisma.organization.findUnique.mockResolvedValue({ plan: 'PRO' });
    prisma.taskAttachment.aggregate.mockResolvedValue({ _sum: { size: 0 } });
    await expect(service.assertCanStore(organizationId, 25 * MB)).resolves.toBeUndefined();
  });

  it('limits how many free organizations a user owns', async () => {
    prisma.membership.count.mockResolvedValue(FREE_ORGANIZATIONS_PER_OWNER - 1);
    await expect(service.assertCanOwnFreeOrganization(tx(), 'user')).resolves.toBeUndefined();
    expect(prisma.membership.count).toHaveBeenCalledWith({
      where: { userId: 'user', role: 'OWNER', organization: { plan: 'FREE' } },
    });
    prisma.membership.count.mockResolvedValue(FREE_ORGANIZATIONS_PER_OWNER);
    await expect(service.assertCanOwnFreeOrganization(tx(), 'user')).rejects.toMatchObject({
      response: { code: 'PLAN_LIMIT_REACHED', limit: 'freeOrganizations' },
    });
  });
});
