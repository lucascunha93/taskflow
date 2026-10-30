import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from './tasks.service.js';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    task: { create: ReturnType<typeof vi.fn> };
  };
  const organizationId = 'organization-a';
  const userId = 'creator';

  beforeEach(async () => {
    prisma = { membership: { findUnique: vi.fn() }, task: { create: vi.fn() } };
    const module = await Test.createTestingModule({
      providers: [TasksService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TasksService);
  });

  it('does not create tasks for a requester outside the organization', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.create(organizationId, userId, { title: 'Task' }))
      .rejects.toMatchObject({ status: 404 });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rejects assignees outside the same organization', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ id: 'creator-membership' }).mockResolvedValueOnce(null);
    await expect(service.create(organizationId, userId, { title: 'Task', assigneeId: 'outsider' }))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.membership.findUnique).toHaveBeenLastCalledWith({
      where: { organizationId_userId: { organizationId, userId: 'outsider' } },
    });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('creates a task with the authenticated creator and authorized assignee', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.create.mockResolvedValue({ id: 'task' });
    await expect(service.create(organizationId, userId, {
      title: ' Task ', description: ' Details ', assigneeId: 'member', dueDate: '2026-10-30',
    })).resolves.toEqual({ id: 'task' });
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        title: 'Task', description: 'Details', organizationId, creatorId: userId,
        assigneeId: 'member', dueDate: new Date('2026-10-30'),
      },
    }));
  });
});
