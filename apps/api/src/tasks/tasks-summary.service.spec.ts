import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from './tasks.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ActivityService } from '../activity/activity.service.js';

describe('Task summary', () => {
  const organizationId = 'organization-a';
  const userId = 'user-a';
  let service: TasksService;
  const prisma = {
    membership: { findUnique: vi.fn() },
    task: { groupBy: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { notify: vi.fn().mockResolvedValue(undefined) } },
        { provide: ActivityService, useValue: { record: vi.fn() } },
      ],
    }).compile();
    service = module.get(TasksService);
  });

  afterEach(() => vi.useRealTimers());

  it('aggregates all statuses and scopes each bounded list to the authenticated tenant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.groupBy.mockResolvedValue([
      { status: 'TODO', _count: { _all: 8 } },
      { status: 'DONE', _count: { _all: 3 } },
    ]);
    prisma.task.findMany.mockResolvedValueOnce([{ id: 'mine' }]).mockResolvedValueOnce([{ id: 'due' }]).mockResolvedValueOnce([{ id: 'recent' }]);
    const result = await service.summary(organizationId, userId);
    expect(result).toEqual({
      total: 11,
      counts: { TODO: 8, IN_PROGRESS: 0, DONE: 3, CANCELLED: 0 },
      asOf: new Date('2026-10-01T12:00:00.000Z'),
      dueUntil: new Date('2026-10-08T12:00:00.000Z'),
      myTasks: [{ id: 'mine' }], dueSoon: [{ id: 'due' }], recentlyUpdated: [{ id: 'recent' }],
    });
    const scope = { organizationId, organization: { memberships: { some: { userId } } } };
    expect(prisma.task.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: scope, by: ['status'] }));
    expect(prisma.task.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { ...scope, assigneeId: userId }, take: 5,
    }));
    expect(prisma.task.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        ...scope, status: { in: ['TODO', 'IN_PROGRESS'] },
        dueDate: { gte: result.asOf, lte: result.dueUntil },
      }, take: 5,
    }));
    expect(prisma.task.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ where: scope, take: 5 }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: 'RepeatableRead' });
  });

  it('returns zero counts for an empty organization', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.task.findMany.mockResolvedValue([]);
    const result = await service.summary(organizationId, userId);
    expect(result.total).toBe(0);
    expect(result.counts).toEqual({ TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 });
    expect(result.myTasks).toEqual([]);
  });

  it('does not query any tasks when the user is not a member', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.summary(organizationId, userId)).rejects.toMatchObject({ status: 404 });
    expect(prisma.task.groupBy).not.toHaveBeenCalled();
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});
