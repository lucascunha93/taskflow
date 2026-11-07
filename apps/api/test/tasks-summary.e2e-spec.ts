import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TasksController } from '../src/tasks/tasks.controller.js';
import { TasksService } from '../src/tasks/tasks.service.js';

describe('Task summary (HTTP with Prisma stub)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const day = 86400000;
  const now = Date.now();
  const tasks = [
    { id: 'a', organizationId: orgA, title: 'Pendente', status: 'TODO', assigneeId: userA, dueDate: new Date(now + day), updatedAt: new Date(now) },
    { id: 'b', organizationId: orgA, title: 'Atrasada', status: 'IN_PROGRESS', assigneeId: null, dueDate: new Date(now - day), updatedAt: new Date(now - day) },
    { id: 'c', organizationId: orgA, title: 'Concluída', status: 'DONE', assigneeId: userA, dueDate: new Date(now + day), updatedAt: new Date(now - 2 * day) },
    { id: 'd', organizationId: orgB, title: 'Outro tenant', status: 'TODO', assigneeId: userA, dueDate: new Date(now + day), updatedAt: new Date(now) },
    { id: 'e', organizationId: orgA, title: 'Prazo distante', status: 'TODO', assigneeId: null, dueDate: new Date(now + 8 * day), updatedAt: new Date(now - 3 * day) },
    { id: 'f', organizationId: orgA, title: 'Cancelada', status: 'CANCELLED', assigneeId: null, dueDate: new Date(now + day), updatedAt: new Date(now - 4 * day) },
  ];
  type Where = {
    organizationId: string;
    organization: { memberships: { some: { userId: string } } };
    assigneeId?: string;
    status?: { in: string[] };
    dueDate?: { gte: Date; lte: Date };
  };
  let app: INestApplication;
  let token: string;
  const findUnique = vi.fn();
  const groupBy = vi.fn();
  const findMany = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    findUnique.mockImplementation(({ where }: { where: { organizationId_userId: { organizationId: string; userId: string } } }) => {
      const membership = where.organizationId_userId;
      return Promise.resolve(membership.organizationId === orgA && membership.userId === userA ? { id: 'membership' } : null);
    });
    const filter = (where: Where) => tasks.filter((task) =>
      where.organization.memberships.some.userId === userA &&
      task.organizationId === where.organizationId &&
      (!where.assigneeId || task.assigneeId === where.assigneeId) &&
      (!where.status || where.status.in.includes(task.status)) &&
      (!where.dueDate || (task.dueDate >= where.dueDate.gte && task.dueDate <= where.dueDate.lte)),
    );
    groupBy.mockImplementation(({ where }: { where: Where }) => Promise.resolve(
      ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map((status) =>
        ({ status, _count: { _all: filter(where).filter((task) => task.status === status).length } })),
    ));
    findMany.mockImplementation(({ where, take }: { where: Where; take: number }) =>
      Promise.resolve(filter(where).slice(0, take).map(({ assigneeId: _assigneeId, ...task }) => task)));
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-only-signing-key-not-used-in-production' })],
      controllers: [TasksController],
      providers: [
        TasksService, JwtAuthGuard,
        { provide: PrismaService, useValue: {
          membership: { findUnique }, task: { groupBy, findMany },
          user: { findUnique: vi.fn().mockResolvedValue({ sessionVersion: 0 }) },
          $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
        } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = await app.get(JwtService).signAsync({ sub: userA });
  });

  afterEach(async () => { await app.close(); });

  it('requires JWT and valid organization UUID', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/summary`).expect(401);
    await request(app.getHttpServer()).get('/organizations/invalid/tasks/summary')
      .set('Authorization', `Bearer ${token}`).expect(400);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('returns tenant totals, current user tasks and only open tasks due in the next seven days', async () => {
    const response = await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/summary`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body.total).toBe(5);
    expect(response.body.counts).toEqual({ TODO: 2, IN_PROGRESS: 1, DONE: 1, CANCELLED: 1 });
    expect(response.body.myTasks.map((task: { id: string }) => task.id)).toEqual(['a', 'c']);
    expect(response.body.dueSoon.map((task: { id: string }) => task.id)).toEqual(['a']);
    expect(response.body.recentlyUpdated.map((task: { id: string }) => task.id)).toEqual(['a', 'b', 'c', 'e', 'f']);
    expect(new Date(response.body.dueUntil).getTime() - new Date(response.body.asOf).getTime()).toBe(7 * day);
  });

  it('returns zero counts and empty lists for an organization without tasks', async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);
    const response = await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/summary`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body.total).toBe(0);
    expect(response.body.counts).toEqual({ TODO: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 });
    expect(response.body.myTasks).toEqual([]);
    expect(response.body.dueSoon).toEqual([]);
    expect(response.body.recentlyUpdated).toEqual([]);
  });

  it('rejects a user without membership without querying the other tenant', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgB}/tasks/summary`)
      .set('Authorization', `Bearer ${token}`).expect(404);
    expect(groupBy).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
