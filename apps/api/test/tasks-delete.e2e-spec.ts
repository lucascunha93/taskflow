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

describe('Task deletion (HTTP with Prisma stub)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const orgMissing = '66666666-6666-4666-8666-666666666666';
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const taskA = '33333333-3333-4333-8333-333333333333';
  const taskB = '44444444-4444-4444-8444-444444444444';
  const missingTask = '55555555-5555-4555-8555-555555555555';
  const memberships = [
    { organizationId: orgA, userId: userA },
    { organizationId: orgB, userId: userB },
  ];
  type Task = { id: string; organizationId: string; version: number };
  type ScopedWhere = {
    id: string;
    organizationId: string;
    organization: { memberships: { some: { userId: string } } };
  };
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let tasks: Task[];
  let deleteMany: ReturnType<typeof vi.fn>;
  let findMembership: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-only-secret-at-least-32-characters');
    tasks = [
      { id: taskA, organizationId: orgA, version: 2 },
      { id: taskB, organizationId: orgB, version: 1 },
    ];
    const isMember = (organizationId: string, userId: string) =>
      memberships.some((member) => member.organizationId === organizationId && member.userId === userId);
    findMembership = vi.fn(({ where }: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }) => {
      const { organizationId, userId } = where.organizationId_userId;
      return Promise.resolve(isMember(organizationId, userId) ? { userId, organizationId } : null);
    });
    const findFirst = vi.fn(({ where }: { where: ScopedWhere }) => {
      const userId = where.organization.memberships.some.userId;
      const task = isMember(where.organizationId, userId)
        ? tasks.find((item) => item.organizationId === where.organizationId && item.id === where.id)
        : undefined;
      return Promise.resolve(task ? { ...task } : null);
    });
    deleteMany = vi.fn(({ where }: { where: ScopedWhere & { version: number } }) => {
      const userId = where.organization.memberships.some.userId;
      if (!isMember(where.organizationId, userId)) {
        return Promise.resolve({ count: 0 });
      }
      const index = tasks.findIndex((task) => task.id === where.id &&
        task.organizationId === where.organizationId && task.version === where.version);
      if (index < 0) {
        return Promise.resolve({ count: 0 });
      }
      tasks.splice(index, 1);
      return Promise.resolve({ count: 1 });
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        membership: { findUnique: findMembership },
        task: { findFirst, deleteMany },
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

  it('deletes only the selected organization task and responds with an empty 204', async () => {
    const response = await request(app.getHttpServer())
      .delete(`/organizations/${orgA}/tasks/${taskA}?version=2`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);
    expect(response.text).toBe('');
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: taskA, organizationId: orgA, version: 2,
        organization: { memberships: { some: { userId: userA } } },
      },
    });
    expect(tasks).toEqual([{ id: taskB, organizationId: orgB, version: 1 }]);
    await request(app.getHttpServer()).delete(`/organizations/${orgA}/tasks/${taskA}?version=2`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgB}/tasks/${taskB}`)
      .set('Authorization', `Bearer ${tokenB}`).expect(200);
  });

  it('rejects unauthenticated deletion before accessing persistence', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgA}/tasks/${taskA}?version=2`)
      .expect(401);
    expect(findMembership).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('hides inaccessible and nonexistent organizations', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgB}/tasks/${taskB}?version=1`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    await request(app.getHttpServer()).delete(`/organizations/${orgMissing}/tasks/${taskA}?version=2`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(2);
  });

  it('returns 404 for nonexistent and cross-tenant tasks without affecting other tenants', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgA}/tasks/${missingTask}?version=1`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    await request(app.getHttpServer()).delete(`/organizations/${orgA}/tasks/${taskB}?version=1`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    expect(tasks).toEqual([
      { id: taskA, organizationId: orgA, version: 2 },
      { id: taskB, organizationId: orgB, version: 1 },
    ]);
  });

  it('returns 409 for a stale version and preserves the task', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgA}/tasks/${taskA}?version=1`)
      .set('Authorization', `Bearer ${tokenA}`).expect(409);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ id: taskA, organizationId: orgA, version: 2 });
  });

  it.each([
    '',
    '?version=0',
    '?version=-1',
    '?version=1.5',
    '?version=abc',
    '?version=2147483648',
    '?version=1&version=2',
    '?version=2&userId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ])('rejects invalid version query %s', async (query) => {
    await request(app.getHttpServer()).delete(`/organizations/${orgA}/tasks/${taskA}${query}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(400);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    `/organizations/invalid/tasks/${taskA}?version=2`,
    `/organizations/${orgA}/tasks/invalid?version=2`,
  ])('rejects invalid UUIDs for %s', async (path) => {
    await request(app.getHttpServer()).delete(path)
      .set('Authorization', `Bearer ${tokenA}`).expect(400);
    expect(findMembership).not.toHaveBeenCalled();
  });
});
