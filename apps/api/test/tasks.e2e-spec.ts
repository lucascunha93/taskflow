import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

vi.mock('@nestjs/observe', () => {
  class ObserveStub {
    static forRoot() {
      return { module: ObserveStub };
    }
  }
  return {
    createObserveModule: () => ({ ObserveModule: ObserveStub, ObserveInstrument: undefined }),
  };
});

describe('Task reads (HTTP with Prisma stub)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const taskA = '33333333-3333-4333-8333-333333333333';
  const taskNewer = '44444444-4444-4444-8444-444444444444';
  const taskB = '55555555-5555-4555-8555-555555555555';
  const memberships = [
    { organizationId: orgA, userId: userA },
    { organizationId: orgB, userId: userB },
  ];
  const tasks = [
    {
      id: taskA, organizationId: orgA, title: 'Older', description: null, status: 'TODO',
      version: 1, dueDate: null, createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z', creatorId: userA, assigneeId: null,
      creator: { id: userA, name: 'User A' }, assignee: null,
    },
    {
      id: taskNewer, organizationId: orgA, title: 'Newer', description: 'Details',
      status: 'IN_PROGRESS', version: 1, dueDate: null, createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z', creatorId: userA, assigneeId: userA,
      creator: { id: userA, name: 'User A' }, assignee: { id: userA, name: 'User A' },
    },
    {
      id: taskB, organizationId: orgB, title: 'Other tenant', description: null, status: 'TODO',
      version: 1, dueDate: null, createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z', creatorId: userB, assigneeId: null,
      creator: { id: userB, name: 'User B' }, assignee: null,
    },
  ];
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let findMany: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let findMembership: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-only-secret-at-least-32-characters');
    const isMember = (organizationId: string, userId: string) =>
      memberships.some((member) => member.organizationId === organizationId && member.userId === userId);

    findMembership = vi.fn(({ where }: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }) => {
      const { organizationId, userId } = where.organizationId_userId;
      return Promise.resolve(isMember(organizationId, userId) ? { userId, organizationId } : null);
    });
    type TaskWhere = {
      organizationId: string;
      organization: { memberships: { some: { userId: string } } };
    };
    findMany = vi.fn(({ where }: { where: TaskWhere }) => {
      const userId = where.organization.memberships.some.userId;
      const visible = isMember(where.organizationId, userId)
        ? tasks.filter((task) => task.organizationId === where.organizationId)
        : [];
      return Promise.resolve(visible.sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      ));
    });
    findFirst = vi.fn(({ where }: { where: TaskWhere & { id: string } }) => {
      const userId = where.organization.memberships.some.userId;
      const task = isMember(where.organizationId, userId)
        ? tasks.find((item) => item.organizationId === where.organizationId && item.id === where.id)
        : undefined;
      return Promise.resolve(task ?? null);
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        membership: { findUnique: findMembership },
        task: { findMany, findFirst },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const jwt = app.get(JwtService);
    tokenA = await jwt.signAsync({ sub: userA });
    tokenB = await jwt.signAsync({ sub: userB });
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('requires authentication for both endpoints', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks`).expect(401);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/${taskA}`).expect(401);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('rejects expired authentication tokens', async () => {
    const expired = await app.get(JwtService).signAsync({ sub: userA }, { expiresIn: -1 });
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks`)
      .set('Authorization', `Bearer ${expired}`).expect(401);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it.each([
    '/organizations/invalid/tasks',
    `/organizations/${orgA}/tasks/invalid`,
    `/organizations/invalid/tasks/${taskA}`,
  ])('rejects invalid UUIDs for %s', async (path) => {
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenA}`).expect(400);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('lists only the authenticated tenant tasks in descending update order', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect([tasks[1], tasks[0]]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: orgA,
        organization: { memberships: { some: { userId: userA } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: expect.objectContaining({
        creator: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      }),
    }));
  });

  it('returns a task in the caller organization with safe creator and assignee fields', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/${taskNewer}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(tasks[1]);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: taskNewer, organizationId: orgA,
        organization: { memberships: { some: { userId: userA } } },
      },
    }));
  });

  it('returns an empty list and supports tasks without an assignee', async () => {
    findMany.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect([]);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(tasks[0]);
  });

  it('hides other tenants and their tasks even when the task ID is known', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgB}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    expect(findMany).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(`/organizations/${orgB}/tasks/${taskB}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    expect(findFirst).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks/${taskB}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgB}/tasks/${taskB}`)
      .set('Authorization', `Bearer ${tokenB}`).expect(200).expect(tasks[2]);
  });
});
