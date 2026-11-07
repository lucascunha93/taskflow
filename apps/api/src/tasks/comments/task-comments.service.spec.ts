import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commentSelect, TaskCommentsService } from './task-comments.service.js';

describe('TaskCommentsService', () => {
  const organizationId = 'org';
  const taskId = 'task';
  const userId = 'user';
  let service: TaskCommentsService;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    task: { findFirst: ReturnType<typeof vi.fn> };
    taskComment: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateManyAndReturn: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
  const comment = (id: string) => ({ id, taskId, body: 'Texto', editedAt: null, createdAt: new Date(), author: { id: userId, name: 'User' } });

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
      task: { findFirst: vi.fn().mockResolvedValue({ id: taskId }) },
      taskComment: {
        findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(),
        updateManyAndReturn: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [TaskCommentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TaskCommentsService);
  });

  it('hides inaccessible organizations and tasks of other organizations behind 404', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(service.list(organizationId, taskId, userId, { limit: 50 })).rejects.toMatchObject({ status: 404 });
    prisma.task.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(organizationId, taskId, userId, { body: 'Oi' })).rejects.toMatchObject({ status: 404 });
    expect(prisma.task.findFirst).toHaveBeenCalledWith({ where: { id: taskId, organizationId }, select: { id: true } });
    expect(prisma.taskComment.create).not.toHaveBeenCalled();
  });

  it('lists comments chronologically with a cursor and a next cursor', async () => {
    prisma.taskComment.findFirst.mockResolvedValue({ id: 'c0' });
    prisma.taskComment.findMany.mockResolvedValue([comment('c1'), comment('c2'), comment('c3')]);
    const result = await service.list(organizationId, taskId, userId, { limit: 2, after: 'c0' });
    expect(prisma.taskComment.findMany).toHaveBeenCalledWith({
      where: { taskId, organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3, cursor: { id: 'c0' }, skip: 1, select: commentSelect,
    });
    expect(result.data.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(result.nextCursor).toBe('c2');
  });

  it('rejects a cursor that belongs to another task', async () => {
    prisma.taskComment.findFirst.mockResolvedValue(null);
    await expect(service.list(organizationId, taskId, userId, { limit: 50, after: 'foreign' }))
      .rejects.toMatchObject({ status: 400 });
    expect(prisma.taskComment.findMany).not.toHaveBeenCalled();
  });

  it('creates a trimmed comment authored by the requester', async () => {
    prisma.taskComment.create.mockResolvedValue(comment('c1'));
    await service.create(organizationId, taskId, userId, { body: '  Olá  ' });
    expect(prisma.taskComment.create).toHaveBeenCalledWith({
      data: { organizationId, taskId, authorId: userId, body: 'Olá' }, select: commentSelect,
    });
  });

  it('lets only the author edit and marks the edit time', async () => {
    prisma.taskComment.updateManyAndReturn.mockResolvedValueOnce([comment('c1')]);
    await service.update(organizationId, taskId, 'c1', userId, { body: 'Novo' });
    expect(prisma.taskComment.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'c1', taskId, organizationId, authorId: userId },
      data: { body: 'Novo', editedAt: expect.any(Date) },
      select: commentSelect,
    });
    prisma.taskComment.findFirst.mockResolvedValueOnce({ id: 'c2' }).mockResolvedValueOnce(null);
    await expect(service.update(organizationId, taskId, 'c2', userId, { body: 'X' })).rejects.toMatchObject({ status: 403 });
    await expect(service.update(organizationId, taskId, 'c3', userId, { body: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('restricts deletion to the author unless the requester is OWNER or ADMIN', async () => {
    prisma.taskComment.findFirst.mockResolvedValue({ id: 'c1' });
    await expect(service.remove(organizationId, taskId, 'c1', userId)).rejects.toMatchObject({ status: 403 });
    expect(prisma.taskComment.deleteMany).toHaveBeenLastCalledWith({
      where: { id: 'c1', taskId, organizationId, authorId: userId },
    });
    prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.taskComment.deleteMany.mockResolvedValue({ count: 1 });
    await service.remove(organizationId, taskId, 'c1', userId);
    expect(prisma.taskComment.deleteMany).toHaveBeenLastCalledWith({ where: { id: 'c1', taskId, organizationId } });
  });
});
