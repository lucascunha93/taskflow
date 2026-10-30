import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TaskStatus } from '../src/tasks/dto/update-task.dto.js';

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

describe('Task updates (HTTP with Prisma stub)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const memberA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const taskA = '33333333-3333-4333-8333-333333333333';
  const taskB = '44444444-4444-4444-8444-444444444444';
  const missingTask = '55555555-5555-4555-8555-555555555555';
  const memberships = [
    { organizationId: orgA, userId: userA },
    { organizationId: orgA, userId: memberA },
    { organizationId: orgB, userId: userB },
  ];
  type StoredTask = {
    id: string;
    organizationId: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    version: number;
    dueDate: string | null;
    createdAt: string;
    updatedAt: string;
    creatorId: string;
    assigneeId: string | null;
    creator: { id: string; name: string };
    assignee: { id: string; name: string } | null;
  };
  type ScopedWhere = {
    id: string;
    organizationId: string;
    organization: { memberships: { some: { userId: string } } };
  };
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let tasks: StoredTask[];
  let updateManyAndReturn: ReturnType<typeof vi.fn>;
  let findMembership: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-only-secret-at-least-32-characters');
    tasks = [
      {
        id: taskA, organizationId: orgA, title: 'Original', description: 'Existing details',
        status: TaskStatus.TODO, version: 1, dueDate: '2026-11-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        creatorId: userA, assigneeId: memberA, creator: { id: userA, name: 'User A' },
        assignee: { id: memberA, name: 'Member A' },
      },
      {
        id: taskB, organizationId: orgB, title: 'Other tenant', description: null,
        status: TaskStatus.TODO, version: 1, dueDate: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        creatorId: userB, assigneeId: null, creator: { id: userB, name: 'User B' }, assignee: null,
      },
    ];
    const isMember = (organizationId: string, userId: string) =>
      memberships.some((member) => member.organizationId === organizationId && member.userId === userId);
    findMembership = vi.fn(({ where }: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }) => {
      const { organizationId, userId } = where.organizationId_userId;
      return Promise.resolve(isMember(organizationId, userId) ? { id: userId } : null);
    });
    const findFirst = vi.fn(({ where }: { where: ScopedWhere }) => {
      const userId = where.organization.memberships.some.userId;
      const task = isMember(where.organizationId, userId)
        ? tasks.find((item) => item.organizationId === where.organizationId && item.id === where.id)
        : undefined;
      return Promise.resolve(task ? { ...task } : null);
    });
    updateManyAndReturn = vi.fn(({ where, data }: {
      where: ScopedWhere & {
        version: number;
        AND?: { organization: { memberships: { some: { userId: string } } } }[];
      };
      data: {
        title?: string;
        description?: string | null;
        status?: TaskStatus;
        assigneeId?: string | null;
        dueDate?: Date | null;
        version: { increment: number };
      };
    }) => {
      const requester = where.organization.memberships.some.userId;
      const assignee = where.AND?.[0]?.organization.memberships.some.userId;
      const task = tasks.find((item) => item.id === where.id &&
        item.organizationId === where.organizationId && item.version === where.version);
      if (!task || !isMember(where.organizationId, requester) ||
        (assignee && !isMember(where.organizationId, assignee))) {
        return Promise.resolve([]);
      }
      if (data.title !== undefined) task.title = data.title;
      if (data.description !== undefined) task.description = data.description;
      if (data.status !== undefined) task.status = data.status;
      if (data.assigneeId !== undefined) {
        task.assigneeId = data.assigneeId;
        task.assignee = data.assigneeId
          ? { id: data.assigneeId, name: data.assigneeId === userA ? 'User A' : 'Member A' }
          : null;
      }
      if (data.dueDate !== undefined) task.dueDate = data.dueDate?.toISOString() ?? null;
      task.version += data.version.increment;
      return Promise.resolve([{ ...task }]);
    });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        membership: { findUnique: findMembership },
        task: { findFirst, updateManyAndReturn },
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

  it('updates and trims the title while preserving omitted fields', async () => {
    const original = { ...tasks[0] };
    await request(app.getHttpServer()).put(`/organizations/${orgA}/tasks/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ version: 1, title: '  New title  ' })
      .expect(200).expect({ ...original, title: 'New title', version: 2 });
  });

  it('updates status, assignee and due date, and allows nullable fields to be cleared', async () => {
    await request(app.getHttpServer()).put(`/organizations/${orgA}/tasks/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ version: 1, status: 'DONE', assigneeId: userA, dueDate: '2026-12-01', description: ' Updated ' })
      .expect(200).expect(({ body }: { body: StoredTask }) => {
        expect(body).toMatchObject({
          status: 'DONE', version: 2, assigneeId: userA, dueDate: '2026-12-01T00:00:00.000Z',
          description: 'Updated',
        });
      });
    await request(app.getHttpServer()).put(`/organizations/${orgA}/tasks/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ version: 2, assigneeId: null, dueDate: null, description: null })
      .expect(200).expect(({ body }: { body: StoredTask }) => {
        expect(body).toMatchObject({ version: 3, assigneeId: null, assignee: null, dueDate: null, description: null });
      });
  });

  it('rejects unauthorized users, another tenant and an assignee outside the organization', async () => {
    const path = `/organizations/${orgA}/tasks/${taskA}`;
    await request(app.getHttpServer()).put(path).send({ version: 1, title: 'New title' }).expect(401);
    await request(app.getHttpServer()).put(path)
      .set('Authorization', `Bearer ${tokenB}`).send({ version: 1, title: 'New title' }).expect(404);
    await request(app.getHttpServer()).put(`/organizations/${orgA}/tasks/${taskB}`)
      .set('Authorization', `Bearer ${tokenA}`).send({ version: 1, title: 'New title' }).expect(404);
    await request(app.getHttpServer()).put(path)
      .set('Authorization', `Bearer ${tokenA}`).send({ version: 1, assigneeId: userB }).expect(403);
    expect(tasks[0].version).toBe(1);
    expect(tasks[1].version).toBe(1);
  });

  it('returns 404 for a nonexistent task', async () => {
    await request(app.getHttpServer()).put(`/organizations/${orgA}/tasks/${missingTask}`)
      .set('Authorization', `Bearer ${tokenA}`).send({ version: 1, title: 'New title' }).expect(404);
  });

  it('accepts only one of two writes based on the same version', async () => {
    const path = `/organizations/${orgA}/tasks/${taskA}`;
    const responses = await Promise.all([
      request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${tokenA}`)
        .send({ version: 1, title: 'First update' }),
      request(app.getHttpServer()).put(path).set('Authorization', `Bearer ${tokenA}`)
        .send({ version: 1, title: 'Second update' }),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(tasks[0].version).toBe(2);
  });

  it.each([
    [{ title: 'Valid title' }],
    [{ version: 0, title: 'Valid title' }],
    [{ version: 1, title: '  ' }],
    [{ version: 1, title: null }],
    [{ version: 1, description: '  ' }],
    [{ version: 1, status: null }],
    [{ version: 1, status: 'UNKNOWN' }],
    [{ version: 1, dueDate: '2026-02-31' }],
    [{ version: 1, assigneeId: 'invalid' }],
    [{ version: 1, creatorId: userB }],
    [{ version: 1, organizationId: orgB }],
  ])('rejects invalid update bodies %#', async (body) => {
    await request(app.getHttpServer()).put(`/organizations/${orgA}/tasks/${taskA}`)
      .set('Authorization', `Bearer ${tokenA}`).send(body).expect(400);
    expect(updateManyAndReturn).not.toHaveBeenCalled();
  });

  it.each([
    `/organizations/invalid/tasks/${taskA}`,
    `/organizations/${orgA}/tasks/invalid`,
  ])('rejects invalid route UUIDs for %s', async (path) => {
    await request(app.getHttpServer()).put(path)
      .set('Authorization', `Bearer ${tokenA}`).send({ version: 1, title: 'New title' }).expect(400);
    expect(findMembership).not.toHaveBeenCalled();
  });
});
