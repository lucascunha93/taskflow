import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { OrganizationsModule } from '../src/organizations/organizations.module.js';
import { OrganizationsService } from '../src/organizations/organizations.service.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TasksModule } from '../src/tasks/tasks.module.js';

type TestUser = { id: string; email: string; token: string };

describe('HTTP integration with isolated PostgreSQL', () => {
  const runId = randomUUID();
  const password = `test-${randomUUID()}`;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousJwtSecret = process.env.JWT_SECRET;
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: TestUser;
  let other: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let candidate: TestUser;
  let orgA: string;
  let orgB: string;
  let taskA: string;
  let taskB: string;

  const auth = (user: TestUser) => `Bearer ${user.token}`;
  const path = (org: string) => `/organizations/${org}/tasks`;

  async function register(label: string): Promise<TestUser> {
    const email = `${label}-${runId}@example.test`;
    const registered = await request(app.getHttpServer()).post('/auth/register')
      .send({ name: `Test ${label}`, email, password }).expect(201);
    userIds.push(registered.body.id);
    const loggedIn = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password }).expect(201);
    return { id: registered.body.id, email, token: loggedIn.body.accessToken };
  }

  async function organization(user: TestUser, name: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', auth(user)).send({ name: `${name} ${runId}` }).expect(201);
    organizationIds.push(response.body.id);
    return response.body.id;
  }

  beforeAll(async () => {
    const raw = process.env.TASKFLOW_INTEGRATION_URL;
    if (!raw || process.env.TASKFLOW_INTEGRATION_CONFIRM !== 'isolated-test-database') {
      throw new Error('Defina TASKFLOW_INTEGRATION_URL e confirme isolated-test-database; nunca use um banco existente.');
    }
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.username !== 'taskflow_test' || url.pathname !== '/taskflow_integration_test' ||
      !url.port || url.port === '5432') {
      throw new Error('A URL de integração deve apontar para o banco dedicado local taskflow_integration_test em porta não padrão.');
    }
    process.env.DATABASE_URL = raw;
    process.env.JWT_SECRET = `integration-only-${randomUUID()}-${randomUUID()}`;
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, OrganizationsModule, TasksModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    owner = await register('owner');
    other = await register('other');
    admin = await register('admin');
    member = await register('member');
    candidate = await register('candidate');
    orgA = await organization(owner, 'Integration A');
    orgB = await organization(other, 'Integration B');
    await request(app.getHttpServer()).post(`/organizations/${orgA}/members`)
      .set('Authorization', auth(owner)).send({ email: admin.email, role: 'ADMIN' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgA}/members`)
      .set('Authorization', auth(admin)).send({ email: member.email, role: 'MEMBER' }).expect(201);
    const first = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Alpha integration task', status: 'TODO', assigneeId: owner.id, dueDate: new Date(Date.now() + 86400000).toISOString() }).expect(201);
    taskA = first.body.id;
    await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Beta integration task', status: 'DONE', assigneeId: member.id }).expect(201);
    const otherTask = await request(app.getHttpServer()).post(path(orgB)).set('Authorization', auth(other))
      .send({ title: 'Other tenant task', status: 'IN_PROGRESS' }).expect(201);
    taskB = otherTask.body.id;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        if (organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      if (app) await app.close();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  it('registers, hashes passwords, rejects duplicates and validates JWTs', async () => {
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(stored.passwordHash, password)).toBe(true);
    await request(app.getHttpServer()).post('/auth/register')
      .send({ name: 'Duplicate User', email: owner.email, password }).expect(409);
    await request(app.getHttpServer()).post('/auth/login')
      .send({ email: owner.email, password: 'incorrect-test-password' }).expect(401);
    const profile = await request(app.getHttpServer()).get('/auth/me').set('Authorization', auth(owner)).expect(200);
    expect(profile.body.id).toBe(owner.id);
    expect(profile.body.passwordHash).toBeUndefined();
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer invalid').expect(401);
    const expired = await app.get(JwtService).signAsync({ sub: owner.id }, { expiresIn: -1 });
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
  });

  it('creates OWNER membership, lists organizations and enforces member roles', async () => {
    expect(await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: orgA, userId: owner.id } } }))
      .toMatchObject({ role: 'OWNER' });
    const organizations = await request(app.getHttpServer()).get('/organizations').set('Authorization', auth(owner)).expect(200);
    expect(organizations.body.map((item: { id: string }) => item.id)).toContain(orgA);
    expect(organizations.body.map((item: { id: string }) => item.id)).not.toContain(orgB);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/members`).set('Authorization', auth(member)).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgA}/members`).set('Authorization', auth(member))
      .send({ email: candidate.email, role: 'MEMBER' }).expect(403);
    await request(app.getHttpServer()).post(`/organizations/${orgA}/members`).set('Authorization', auth(admin))
      .send({ email: candidate.email, role: 'ADMIN' }).expect(403);
  });

  it('paginates, filters, sorts and reads real tasks and aggregates the entire tenant', async () => {
    const list = await request(app.getHttpServer()).get(path(orgA)).set('Authorization', auth(owner))
      .query({ page: 1, limit: 1, sortBy: 'title', sortOrder: 'asc' }).expect(200);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(list.body.data[0].id).toBe(taskA);
    const secondPage = await request(app.getHttpServer()).get(path(orgA)).set('Authorization', auth(owner))
      .query({ page: 2, limit: 1, sortBy: 'title', sortOrder: 'asc' }).expect(200);
    expect(secondPage.body.data[0].title).toBe('Beta integration task');
    const descending = await request(app.getHttpServer()).get(path(orgA)).set('Authorization', auth(owner))
      .query({ sortBy: 'title', sortOrder: 'desc' }).expect(200);
    expect(descending.body.data.map((task: { title: string }) => task.title))
      .toEqual(['Beta integration task', 'Alpha integration task']);
    const filtered = await request(app.getHttpServer()).get(path(orgA)).set('Authorization', auth(owner))
      .query({ status: 'DONE', assigneeId: member.id, search: 'Beta' }).expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].creator.id).toBe(owner.id);
    expect(filtered.body.data[0].assignee.id).toBe(member.id);
    const byDateAndCreator = await request(app.getHttpServer()).get(path(orgA)).set('Authorization', auth(owner))
      .query({ creatorId: owner.id, dueDateFrom: new Date().toISOString(), dueDateTo: new Date(Date.now() + 2 * 86400000).toISOString() }).expect(200);
    expect(byDateAndCreator.body.data.map((task: { id: string }) => task.id)).toEqual([taskA]);
    const detail = await request(app.getHttpServer()).get(`${path(orgA)}/${taskA}`).set('Authorization', auth(owner)).expect(200);
    expect(detail.body).toMatchObject({ id: taskA, organizationId: orgA, assigneeId: owner.id, version: 1 });
    const summary = await request(app.getHttpServer()).get(`${path(orgA)}/summary`).set('Authorization', auth(owner)).expect(200);
    expect(summary.body.total).toBe(2);
    expect(summary.body.counts).toEqual({ TODO: 1, IN_PROGRESS: 0, DONE: 1, CANCELLED: 0 });
    expect(summary.body.myTasks.map((task: { id: string }) => task.id)).toEqual([taskA]);
    expect(summary.body.dueSoon.map((task: { id: string }) => task.id)).toEqual([taskA]);
    expect(summary.body.recentlyUpdated.every((task: { organizationId: string }) => task.organizationId === orgA)).toBe(true);
    const otherSummary = await request(app.getHttpServer()).get(`${path(orgB)}/summary`).set('Authorization', auth(other)).expect(200);
    expect(otherSummary.body.total).toBe(1);
    expect(otherSummary.body.counts).toEqual({ TODO: 0, IN_PROGRESS: 1, DONE: 0, CANCELLED: 0 });
  });

  it('isolates tenants for list, details, writes, members and dashboard', async () => {
    await request(app.getHttpServer()).get(path(orgA)).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).get(`${path(orgA)}/${taskA}`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).put(`${path(orgA)}/${taskA}`).set('Authorization', auth(other))
      .send({ version: 1, title: 'Unauthorized edit' }).expect(404);
    await request(app.getHttpServer()).delete(`${path(orgA)}/${taskA}`).set('Authorization', auth(other))
      .query({ version: 1 }).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/members`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).get(`${path(orgA)}/summary`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).get(`${path(orgA)}/${taskB}`).set('Authorization', auth(owner)).expect(404);
    await request(app.getHttpServer()).put(`${path(orgA)}/${taskB}`).set('Authorization', auth(owner))
      .send({ version: 1, title: 'Wrong organization' }).expect(404);
    await request(app.getHttpServer()).delete(`${path(orgA)}/${taskB}`).set('Authorization', auth(owner))
      .query({ version: 1 }).expect(404);
    await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Invalid assignee', assigneeId: other.id }).expect(403);
    await request(app.getHttpServer()).put(`${path(orgA)}/${taskA}`).set('Authorization', auth(owner))
      .send({ version: 1, assigneeId: other.id }).expect(403);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskA } })).toMatchObject({ version: 1, title: 'Alpha integration task' });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskB } })).toMatchObject({ version: 1, organizationId: orgB });
  });

  it('creates, updates, assigns and deletes using the returned version', async () => {
    const created = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Mutable integration task' }).expect(201);
    const url = `${path(orgA)}/${created.body.id}`;
    const updated = await request(app.getHttpServer()).put(url).set('Authorization', auth(owner))
      .send({ version: 1, title: 'Edited integration task', assigneeId: member.id }).expect(200);
    expect(updated.body).toMatchObject({ title: 'Edited integration task', version: 2, assigneeId: member.id });
    await request(app.getHttpServer()).put(url).set('Authorization', auth(owner)).send({ version: 1, title: 'Stale update' }).expect(409);
    await request(app.getHttpServer()).delete(url).set('Authorization', auth(owner)).query({ version: 1 }).expect(409);
    await request(app.getHttpServer()).delete(url).set('Authorization', auth(owner)).query({ version: 2 }).expect(204);
    await request(app.getHttpServer()).get(url).set('Authorization', auth(owner)).expect(404);
  });

  it('allows exactly one simultaneous update with the same version', async () => {
    const url = `${path(orgA)}/${taskA}`;
    const results = await Promise.all(['Concurrent one', 'Concurrent two'].map((title) =>
      request(app.getHttpServer()).put(url).set('Authorization', auth(owner)).send({ version: 1, title })));
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: taskA } });
    expect(stored.version).toBe(2);
    expect(['Concurrent one', 'Concurrent two']).toContain(stored.title);
  });

  it('allows exactly one concurrent duplicate membership', async () => {
    const results = await Promise.all([1, 2].map(() =>
      request(app.getHttpServer()).post(`/organizations/${orgA}/members`).set('Authorization', auth(owner))
        .send({ email: candidate.email, role: 'MEMBER' })));
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(await prisma.membership.count({ where: { organizationId: orgA, userId: candidate.id } })).toBe(1);
  });

  it('rolls back organization creation when OWNER membership violates a foreign key', async () => {
    const name = `Rollback ${runId}`;
    await expect(app.get(OrganizationsService).create(randomUUID(), { name })).rejects.toThrow();
    expect(await prisma.organization.count({ where: { name } })).toBe(0);
  });

  it('has migrated enums, indexes and enforced referential integrity', async () => {
    const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(migrations.map((item) => item.migration_name)).toEqual(expect.arrayContaining([
      '20261028161006_init', '20261028200344_add_user_password_hash',
    ]));
    const enums = await prisma.$queryRaw<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname IN ('MembershipRole', 'TaskStatus')`;
    expect(enums.filter((item) => item.typname === 'MembershipRole').map((item) => item.enumlabel).sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);
    expect(enums.filter((item) => item.typname === 'TaskStatus').map((item) => item.enumlabel).sort()).toEqual(['CANCELLED', 'DONE', 'IN_PROGRESS', 'TODO']);
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
      AND tablename IN ('organizations', 'users', 'memberships', 'tasks')`;
    expect(indexes.map((item) => item.indexname)).toEqual(expect.arrayContaining([
      'organizations_slug_key', 'users_email_key',
      'memberships_organizationId_userId_key', 'memberships_userId_idx',
      'tasks_organizationId_status_updatedAt_idx', 'tasks_organizationId_assigneeId_idx',
    ]));
    const foreignKeys = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'f' AND connamespace = current_schema()::regnamespace`;
    expect(foreignKeys.map((item) => item.conname)).toEqual(expect.arrayContaining([
      'memberships_organizationId_fkey', 'memberships_userId_fkey', 'tasks_organizationId_fkey',
      'tasks_creatorId_fkey', 'tasks_assigneeId_fkey',
    ]));
    await expect(prisma.membership.create({ data: { organizationId: randomUUID(), userId: owner.id } }))
      .rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces restrict, set-null and cascade relations', async () => {
    const creator = await register('relations-creator');
    const assignee = await register('relations-assignee');
    const org = await organization(creator, 'Relations');
    await request(app.getHttpServer()).post(`/organizations/${org}/members`).set('Authorization', auth(creator))
      .send({ email: assignee.email, role: 'MEMBER' }).expect(201);
    const created = await request(app.getHttpServer()).post(path(org)).set('Authorization', auth(creator))
      .send({ title: 'Relation integrity task', assigneeId: assignee.id }).expect(201);
    await expect(prisma.user.delete({ where: { id: creator.id } })).rejects.toMatchObject({ code: 'P2003' });
    await prisma.user.delete({ where: { id: assignee.id } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: created.body.id } })).assigneeId).toBeNull();
    expect(await prisma.membership.count({ where: { organizationId: org, userId: assignee.id } })).toBe(0);
    await prisma.organization.delete({ where: { id: org } });
    expect(await prisma.task.findUnique({ where: { id: created.body.id } })).toBeNull();
    expect(await prisma.membership.count({ where: { organizationId: org } })).toBe(0);
  });
});
