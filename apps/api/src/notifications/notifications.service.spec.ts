import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { notificationSelect, NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  const userId = 'user';
  const visible = { userId, organization: { memberships: { some: { userId } } } };
  let service: NotificationsService;
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    notification: {
      createMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      notification: {
        createMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('notifies each distinct recipient except the actor, using the given client', async () => {
    const tx = { notification: { createMany: vi.fn() } };
    await service.notify(tx as never, {
      organizationId: 'o', taskId: 't', taskTitle: 'T', actorId: 'actor', type: 'TASK_COMMENTED',
      recipients: ['actor', 'creator', null, 'creator', 'assignee', undefined],
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith({ data: ['creator', 'assignee'].map((id) => ({
      userId: id, organizationId: 'o', taskId: 't', taskTitle: 'T', actorId: 'actor', type: 'TASK_COMMENTED',
    })) });
    await service.notify(tx as never, {
      organizationId: 'o', taskId: 't', taskTitle: 'T', actorId: 'actor', type: 'TASK_ASSIGNED', recipients: ['actor'],
    });
    expect(tx.notification.createMany).toHaveBeenCalledOnce();
  });

  it('lists only notifications of organizations the user still belongs to, with the unread count', async () => {
    prisma.notification.count.mockResolvedValue(3);
    await expect(service.list(userId, { unread: true, limit: 5 })).resolves.toEqual({ data: [], nextCursor: null, unreadCount: 3 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { ...visible, readAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 6, select: notificationSelect,
    });
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { ...visible, readAt: null } });
  });

  it('rejects a cursor outside the visible notifications', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.list(userId, { before: 'other' })).rejects.toMatchObject({ status: 400 });
  });

  it('marks one notification as read, is idempotent and hides other users notifications', async () => {
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.markRead(userId, 'n1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { ...visible, id: 'n1', readAt: null }, data: { readAt: expect.any(Date) },
    });
    prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n1' });
    await expect(service.markRead(userId, 'n1')).resolves.toBeUndefined();
    prisma.notification.findFirst.mockResolvedValueOnce(null);
    await expect(service.markRead(userId, 'foreign')).rejects.toMatchObject({ status: 404 });
  });

  it('marks every visible unread notification as read', async () => {
    await service.markAllRead(userId);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { ...visible, readAt: null }, data: { readAt: expect.any(Date) },
    });
  });
});
