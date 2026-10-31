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

describe('Task listing (HTTP with Prisma stub)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const orgEmpty = '99999999-9999-4999-8999-999999999999';
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const memberA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const tasks = [
    { id: '1', organizationId: orgA, title: 'Zeta', status: TaskStatus.TODO, assigneeId: userA, creatorId: userA, dueDate: '2026-10-10T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', organizationId: orgA, title: 'Alpha', status: TaskStatus.DONE, assigneeId: memberA, creatorId: userA, dueDate: '2026-10-10T23:59:59.999Z', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: '3', organizationId: orgA, title: 'Beta%', status: TaskStatus.IN_PROGRESS, assigneeId: null, creatorId: memberA, dueDate: '2026-10-11T00:00:00.000Z', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z' },
    { id: '4', organizationId: orgA, title: 'Gamma_', status: TaskStatus.DONE, assigneeId: null, creatorId: memberA, dueDate: null, createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z' },
    { id: '5', organizationId: orgB, title: 'Other tenant', status: TaskStatus.DONE, assigneeId: userB, creatorId: userB, dueDate: null, createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' },
  ];
  type Task = (typeof tasks)[number];
  type TaskWhere = {
    organizationId: string;
    organization: { memberships: { some: { userId: string } } };
    status?: TaskStatus;
    assigneeId?: string;
    creatorId?: string;
    title?: { contains: string; mode: 'insensitive' };
    dueDate?: { gte?: Date; lte?: Date };
  };
  type ListResponse = {
    data: Task[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  };
  let app: INestApplication;
  let tokenA: string;
  let findMany: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let findMembership: ReturnType<typeof vi.fn>;
  let lastWhere: TaskWhere | undefined;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-only-secret-at-least-32-characters');
    lastWhere = undefined;
    const isMember = (organizationId: string, userId: string) =>
      userId === userA && (organizationId === orgA || organizationId === orgEmpty);
    findMembership = vi.fn(({ where }: {
      where: { organizationId_userId: { organizationId: string; userId: string } };
    }) => {
      const { organizationId, userId } = where.organizationId_userId;
      return Promise.resolve(isMember(organizationId, userId) ? { organizationId, userId } : null);
    });
    const filterTasks = (where: TaskWhere) => {
      if (!isMember(where.organizationId, where.organization.memberships.some.userId)) return [];
      return tasks.filter((task) => {
        if (task.organizationId !== where.organizationId) return false;
        if (where.status !== undefined && task.status !== where.status) return false;
        if (where.assigneeId !== undefined && task.assigneeId !== where.assigneeId) return false;
        if (where.creatorId !== undefined && task.creatorId !== where.creatorId) return false;
        if (where.title !== undefined) {
          const text = where.title.contains.replace(/\\([\\%_])/g, '$1');
          if (!task.title.toLowerCase().includes(text.toLowerCase())) return false;
        }
        if (where.dueDate !== undefined) {
          if (task.dueDate === null) return false;
          const dueDate = new Date(task.dueDate).getTime();
          if (where.dueDate.gte && dueDate < where.dueDate.gte.getTime()) return false;
          if (where.dueDate.lte && dueDate > where.dueDate.lte.getTime()) return false;
        }
        return true;
      });
    };
    findMany = vi.fn(({ where, skip, take, orderBy }: {
      where: TaskWhere; skip: number; take: number;
      orderBy: Partial<Record<'createdAt' | 'updatedAt' | 'dueDate' | 'title' | 'id', 'asc' | 'desc'>>[];
    }) => {
      const sorted = filterTasks(where);
      lastWhere = where;
      sorted.sort((a, b) => {
        for (const order of orderBy) {
          for (const field of ['createdAt', 'updatedAt', 'dueDate', 'title', 'id'] as const) {
            const direction = order[field];
            if (direction === undefined) continue;
            const av = a[field];
            const bv = b[field];
            const comparison = av === bv ? 0 : av === null ? 1 : bv === null ? -1 : av.localeCompare(bv);
            if (comparison !== 0) return direction === 'asc' ? comparison : -comparison;
          }
        }
        return 0;
      });
      return Promise.resolve(sorted.slice(skip, skip + take));
    });
    count = vi.fn(({ where }: { where: TaskWhere }) => Promise.resolve(filterTasks(where).length));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
        membership: { findUnique: findMembership },
        task: { findMany, count },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    tokenA = await app.get(JwtService).signAsync({ sub: userA });
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('uses the default page and limit and sorts by most recently updated', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.meta).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
        expect(body.data.map((task) => task.id)).toEqual(['4', '3', '2', '1']);
      });
  });

  it('uses skip and take for specific pages, including pages without results', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks?page=2&limit=2`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.meta).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });
        expect(body.data.map((task) => task.id)).toEqual(['2', '1']);
      });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2, take: 2 }));
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks?page=3&limit=2`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.meta).toEqual({ page: 3, limit: 2, total: 4, totalPages: 2 });
        expect(body.data).toEqual([]);
      });
  });

  it('accepts the maximum limit and returns zero pages for an empty organization', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgEmpty}/tasks?limit=100`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body).toEqual({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } });
      });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it.each([
    ['status=DONE', ['4', '2']],
    [`assigneeId=${userA}`, ['1']],
    [`creatorId=${memberA}`, ['4', '3']],
    ['search=ALP', ['2']],
    ['search=%25', ['3']],
    ['search=_', ['4']],
    ['dueDateFrom=2026-10-10&dueDateTo=2026-10-10', ['2', '1']],
    ['dueDateFrom=2026-10-10T23%3A59%3A59.999Z&dueDateTo=2026-10-11T00%3A00%3A00Z', ['3', '2']],
    ['sortBy=title&sortOrder=asc', ['2', '3', '4', '1']],
    ['sortBy=title&sortOrder=desc', ['1', '4', '3', '2']],
    ['sortBy=updatedAt&sortOrder=asc', ['1', '2', '3', '4']],
    ['sortBy=dueDate&sortOrder=asc', ['1', '2', '3', '4']],
    ['sortBy=dueDate&sortOrder=desc', ['4', '3', '2', '1']],
    ['sortBy=createdAt&sortOrder=asc', ['1', '2', '3', '4']],
  ])('applies %s', async (query, expected) => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks?${query}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.data.map((task) => task.id)).toEqual(expected);
        expect(body.meta.total).toBe(expected.length);
      });
  });

  it('combines filters without including another tenant and uses the same predicate for count', async () => {
    const query = `status=DONE&creatorId=${userA}&assigneeId=${memberA}&search=ALP` +
      '&dueDateFrom=2026-10-10&dueDateTo=2026-10-10&sortBy=createdAt&sortOrder=asc';
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks?${query}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.data.map((task) => task.id)).toEqual(['2']);
        expect(body.meta.total).toBe(1);
      });
    expect(count).toHaveBeenCalledWith({ where: lastWhere });
    expect(lastWhere?.organizationId).toBe(orgA);
  });

  it('rejects unauthorized users and organization overrides', async () => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks`).expect(401);
    await request(app.getHttpServer()).get(`/organizations/${orgB}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks?organizationId=${orgB}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(400);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it.each([
    'page=0', 'page=1.5', 'page=abc', 'page=1&page=2', 'page=2147483647&limit=100',
    'limit=0', 'limit=101', 'limit=1.5', 'status=INVALID',
    'assigneeId=invalid', 'creatorId=invalid', 'search=%20%20',
    'sortBy=organizationId', 'sortOrder=up',
    'dueDateFrom=2026-02-31', 'dueDateTo=invalid',
    'dueDateFrom=2026-10-11&dueDateTo=2026-10-10',
    'dueDateFrom=2026-10-10T10%3A00%3A00',
    'dueDateFrom=2026-10-10T23%3A30%3A00-03%3A00&dueDateTo=2026-10-10',
  ])('rejects invalid parameters %s', async (query) => {
    await request(app.getHttpServer()).get(`/organizations/${orgA}/tasks?${query}`)
      .set('Authorization', `Bearer ${tokenA}`).expect(400);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('accepts a timestamp and an end-of-day date from the same UTC day', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${orgA}/tasks?dueDateFrom=2026-10-10T23%3A00%3A00Z&dueDateTo=2026-10-10`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.data.map((task) => task.id)).toEqual(['2']);
      });
  });

  it('compares date bounds as instants rather than text when offsets are present', async () => {
    await request(app.getHttpServer())
      .get(`/organizations/${orgA}/tasks?dueDateFrom=2026-10-11T00%3A30%3A00%2B02%3A00&dueDateTo=2026-10-10`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200).expect(({ body }: { body: ListResponse }) => {
        expect(body.data.map((task) => task.id)).toEqual(['2']);
      });
  });
});
