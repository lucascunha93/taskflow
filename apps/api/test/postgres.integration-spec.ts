import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { MAX_FAILED_LOGINS } from '../src/auth/auth.service.js';
import { REFRESH_COOKIE } from '../src/auth/refresh-cookie.js';
import { REFRESH_REUSE_GRACE_MS } from '../src/auth/refresh-tokens.service.js';
import { OrganizationsModule } from '../src/organizations/organizations.module.js';
import { OrganizationsService } from '../src/organizations/organizations.service.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TasksModule } from '../src/tasks/tasks.module.js';
import { ProjectsModule } from '../src/projects/projects.module.js';
import { StorageModule } from '../src/storage/storage.module.js';
import { PlansModule } from '../src/plans/plans.module.js';
import { BillingModule } from '../src/billing/billing.module.js';
import { MailModule } from '../src/mail/mail.module.js';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FREE_ORGANIZATIONS_PER_OWNER, PLANS } from '../src/plans/plan-limits.js';

type TestUser = { id: string; email: string; token: string };

describe('HTTP integration with isolated PostgreSQL', () => {
  const runId = randomUUID();
  const password = `test-${randomUUID()}`;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousJwtSecret = process.env.JWT_SECRET;
  const previousBilling = process.env.BILLING_PROVIDER;
  const mailKeys = ['MAIL_PROVIDER', 'MAIL_OUTBOX_DIR', 'APP_URL'] as const;
  const previousMail = Object.fromEntries(mailKeys.map((key) => [key, process.env[key]]));
  const outbox = mkdtempSync(join(tmpdir(), 'taskflow-mail-'));
  const s3Keys = ['S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE', 'S3_CREATE_BUCKET'] as const;
  const previousS3 = Object.fromEntries(s3Keys.map((key) => [key, process.env[key]]));
  let s3: S3Client;
  const s3Bucket = 'taskflow-integration-test';
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
  const refreshHeader = { 'X-TaskFlow-Request': '1' };
  const refreshCookie = (response: request.Response): string => {
    const value = ([] as string[]).concat(response.headers['set-cookie'] ?? [])
      .find((item) => item.startsWith(`${REFRESH_COOKIE}=`));
    if (!value) throw new Error('Refresh cookie not set');
    return value.split(';')[0];
  };
  const loginWithCookie = async (email: string, secret = password) =>
    refreshCookie(await request(app.getHttpServer()).post('/auth/login').send({ email, password: secret }).expect(201));
  const refresh = (cookie: string) =>
    request(app.getHttpServer()).post('/auth/refresh').set(refreshHeader).set('Cookie', cookie);
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
    process.env.BILLING_PROVIDER = 'fake';
    Object.assign(process.env, { MAIL_PROVIDER: 'file', MAIL_OUTBOX_DIR: outbox, APP_URL: 'https://app.example.test' });

    // Armazenamento S3 dedicado aos testes, com as mesmas salvaguardas do banco.
    const s3Url = process.env.TASKFLOW_INTEGRATION_S3_URL;
    const s3AccessKey = process.env.TASKFLOW_INTEGRATION_S3_ACCESS_KEY;
    const s3Secret = process.env.TASKFLOW_INTEGRATION_S3_SECRET;
    if (!s3Url || !s3AccessKey || !s3Secret) {
      throw new Error('Defina TASKFLOW_INTEGRATION_S3_URL, TASKFLOW_INTEGRATION_S3_ACCESS_KEY e TASKFLOW_INTEGRATION_S3_SECRET.');
    }
    const parsedS3 = new URL(s3Url);
    if (parsedS3.hostname !== '127.0.0.1' || !parsedS3.port || parsedS3.port === '8333' || parsedS3.port === '9000') {
      throw new Error('O S3 de integração deve ser local (127.0.0.1) e em porta diferente das usadas em desenvolvimento.');
    }
    Object.assign(process.env, {
      S3_ENDPOINT: parsedS3.origin, S3_PUBLIC_ENDPOINT: parsedS3.origin, S3_REGION: 'us-east-1', S3_BUCKET: s3Bucket,
      S3_ACCESS_KEY_ID: s3AccessKey, S3_SECRET_ACCESS_KEY: s3Secret, S3_FORCE_PATH_STYLE: 'true', S3_CREATE_BUCKET: 'true',
    });
    s3 = new S3Client({
      endpoint: parsedS3.origin, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3Secret },
    });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, StorageModule, MailModule, AuthModule, PlansModule, OrganizationsModule, TasksModule, ProjectsModule, BillingModule],
    })
      // O limite por IP tem teste HTTP próprio; aqui ele mascararia o bloqueio por conta.
      .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
      .compile();
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
        // Refresh tokens são removidos em cascata com os usuários.
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      if (app) await app.close();
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
      if (previousBilling === undefined) delete process.env.BILLING_PROVIDER;
      else process.env.BILLING_PROVIDER = previousBilling;
      for (const key of mailKeys) {
        if (previousMail[key] === undefined) delete process.env[key];
        else process.env[key] = previousMail[key];
      }
      rmSync(outbox, { recursive: true, force: true });
      for (const key of s3Keys) {
        if (previousS3[key] === undefined) delete process.env[key];
        else process.env[key] = previousS3[key];
      }
      s3?.destroy();
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

  it('renames organizations only for their managers and keeps the slug', async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    const name = `Integration A renamed ${runId}`;
    await request(app.getHttpServer()).patch(`/organizations/${orgA}`).set('Authorization', auth(member))
      .send({ name: 'Member rename' }).expect(403);
    await request(app.getHttpServer()).patch(`/organizations/${orgA}`).set('Authorization', auth(other))
      .send({ name: 'Cross tenant rename' }).expect(404);
    await request(app.getHttpServer()).patch(`/organizations/${orgB}`).set('Authorization', auth(admin))
      .send({ name: 'Cross tenant rename' }).expect(404);
    const renamed = await request(app.getHttpServer()).patch(`/organizations/${orgA}`).set('Authorization', auth(admin))
      .send({ name: ` ${name} ` }).expect(200);
    expect(renamed.body).toMatchObject({ id: orgA, name, slug: before.slug, role: 'ADMIN' });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: orgB } }))
      .toMatchObject({ name: expect.stringContaining('Integration B') });
  });

  it('updates only the profile name of the authenticated user', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
    const updated = await request(app.getHttpServer()).patch('/auth/me').set('Authorization', auth(candidate))
      .send({ name: ' Candidate renamed ' }).expect(200);
    expect(updated.body).toEqual({
      id: candidate.id, name: 'Candidate renamed', email: candidate.email, createdAt: before.createdAt.toISOString(),
    });
    await request(app.getHttpServer()).patch('/auth/me').set('Authorization', auth(candidate))
      .send({ name: 'Other', email: owner.email }).expect(400);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(stored.email).toBe(candidate.email);
    expect(stored.passwordHash).toBe(before.passwordHash);
  });

  it('locks an account after consecutive failures and resets the state after a later success', async () => {
    const locked = await register('locked');
    for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
      await request(app.getHttpServer()).post('/auth/login')
        .send({ email: locked.email, password: 'incorrect-test-password' }).expect(401);
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: locked.id } });
    expect(stored.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(stored.failedLoginAttempts).toBe(0);
    await request(app.getHttpServer()).post('/auth/login').send({ email: locked.email, password }).expect(429);
    await prisma.user.update({ where: { id: locked.id }, data: { lockedUntil: new Date(Date.now() - 1000), failedLoginAttempts: 2 } });
    await request(app.getHttpServer()).post('/auth/login').send({ email: locked.email, password }).expect(201);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: locked.id } }))
      .toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
  });

  it('changes the password and immediately revokes previously issued tokens', async () => {
    const changer = await register('changer');
    const newPassword = `changed-${randomUUID()}`;
    await request(app.getHttpServer()).put('/auth/me/password').set('Authorization', auth(changer))
      .send({ currentPassword: 'incorrect-test-password', newPassword }).expect(403);
    const changed = await request(app.getHttpServer()).put('/auth/me/password').set('Authorization', auth(changer))
      .send({ currentPassword: password, newPassword }).expect(200);
    expect(changed.body.user).toMatchObject({ id: changer.id, email: changer.email });
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', auth(changer)).expect(401);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${changed.body.accessToken}`).expect(200);
    await request(app.getHttpServer()).post('/auth/login').send({ email: changer.email, password }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: changer.email, password: newPassword }).expect(201);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: changer.id } })).toMatchObject({ sessionVersion: 1 });
  });

  it('revokes every session of the user, including the one that requested it', async () => {
    const sessions = await register('sessions');
    const second = await request(app.getHttpServer()).post('/auth/login')
      .send({ email: sessions.email, password }).expect(201);
    await request(app.getHttpServer()).delete('/auth/me/sessions').set('Authorization', auth(sessions)).expect(204);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', auth(sessions)).expect(401);
    await request(app.getHttpServer()).get('/organizations')
      .set('Authorization', `Bearer ${second.body.accessToken}`).expect(401);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', auth(owner)).expect(200);
  });

  it('rotates refresh tokens, tolerates a concurrent refresh and revokes the family on reuse', async () => {
    const holder = await register('refresh');
    const first = await loginWithCookie(holder.email);
    const stored = await prisma.refreshToken.findMany({ where: { userId: holder.id } });
    expect(stored.every((item) => item.tokenHash.length === 64 && !first.includes(item.tokenHash))).toBe(true);

    const rotated = await refresh(first).expect(200);
    const second = refreshCookie(rotated);
    expect(second).not.toBe(first);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(200);
    await refresh(first).expect(409);

    await prisma.refreshToken.updateMany({
      where: { userId: holder.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
    });
    await refresh(first).expect(401);
    await refresh(second).expect(401);
    const other = await loginWithCookie(holder.email);
    await refresh(other).expect(200);
  });

  it('invalidates refresh tokens on logout, password change and session revocation', async () => {
    const holder = await register('refresh-revocation');
    const loggedOut = await loginWithCookie(holder.email);
    await request(app.getHttpServer()).post('/auth/logout').set(refreshHeader).set('Cookie', loggedOut).expect(204);
    await refresh(loggedOut).expect(401);

    const beforeChange = await loginWithCookie(holder.email);
    const newPassword = `refresh-${randomUUID()}`;
    const changed = await request(app.getHttpServer()).put('/auth/me/password').set('Authorization', auth(holder))
      .send({ currentPassword: password, newPassword }).expect(200);
    await refresh(beforeChange).expect(401);
    const afterChange = refreshCookie(changed);
    const renewed = await refresh(afterChange).expect(200);

    await request(app.getHttpServer()).delete('/auth/me/sessions')
      .set('Authorization', `Bearer ${renewed.body.accessToken}`).expect(204);
    await refresh(refreshCookie(renewed)).expect(401);
    const withoutHeader = await loginWithCookie(holder.email, newPassword);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', withoutHeader).expect(403);
  });

  it('keeps comments inside the tenant and enforces author and moderator rules', async () => {
    const comments = (org: string, task: string) => `/organizations/${org}/tasks/${task}/comments`;
    const created = await request(app.getHttpServer()).post(comments(orgA, taskA)).set('Authorization', auth(member))
      .send({ body: '  Primeiro comentário  ' }).expect(201);
    expect(created.body).toMatchObject({ body: 'Primeiro comentário', author: { id: member.id }, editedAt: null });
    await request(app.getHttpServer()).post(comments(orgA, taskA)).set('Authorization', auth(owner))
      .send({ body: 'Resposta' }).expect(201);

    await request(app.getHttpServer()).get(comments(orgA, taskA)).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).post(comments(orgA, taskB)).set('Authorization', auth(owner))
      .send({ body: 'Tarefa de outro tenant' }).expect(404);
    await request(app.getHttpServer()).get(comments(orgB, taskB)).set('Authorization', auth(owner)).expect(404);

    const page = await request(app.getHttpServer()).get(`${comments(orgA, taskA)}?limit=1`)
      .set('Authorization', auth(admin)).expect(200);
    expect(page.body.data.map((item: { body: string }) => item.body)).toEqual(['Primeiro comentário']);
    const next = await request(app.getHttpServer()).get(`${comments(orgA, taskA)}?limit=1&after=${page.body.nextCursor}`)
      .set('Authorization', auth(admin)).expect(200);
    expect(next.body).toMatchObject({ data: [{ body: 'Resposta' }], nextCursor: null });

    const id = created.body.id as string;
    await request(app.getHttpServer()).patch(`${comments(orgA, taskA)}/${id}`).set('Authorization', auth(owner))
      .send({ body: 'Edição alheia' }).expect(403);
    const edited = await request(app.getHttpServer()).patch(`${comments(orgA, taskA)}/${id}`).set('Authorization', auth(member))
      .send({ body: 'Editado' }).expect(200);
    expect(edited.body.editedAt).toEqual(expect.any(String));
    const ownerComment = next.body.data[0].id as string;
    await request(app.getHttpServer()).delete(`${comments(orgA, taskA)}/${ownerComment}`).set('Authorization', auth(member)).expect(403);
    await request(app.getHttpServer()).delete(`${comments(orgA, taskA)}/${id}`).set('Authorization', auth(admin)).expect(204);
    await request(app.getHttpServer()).delete(`${comments(orgA, taskA)}/${id}`).set('Authorization', auth(admin)).expect(404);

    await expect(prisma.taskComment.create({
      data: { organizationId: orgB, taskId: taskA, authorId: owner.id, body: 'Organização divergente' },
    })).rejects.toThrow();

    const temporary = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Temporary commented task' }).expect(201);
    await request(app.getHttpServer()).post(comments(orgA, temporary.body.id)).set('Authorization', auth(owner))
      .send({ body: 'Será removido junto' }).expect(201);
    await request(app.getHttpServer()).delete(`${path(orgA)}/${temporary.body.id}?version=1`).set('Authorization', auth(owner)).expect(204);
    expect(await prisma.taskComment.count({ where: { taskId: temporary.body.id } })).toBe(0);
  });

  it('records task history in the same transaction and keeps it inside the tenant', async () => {
    const created = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'History task', status: 'TODO' }).expect(201);
    const id = created.body.id as string;
    await request(app.getHttpServer()).put(`${path(orgA)}/${id}`).set('Authorization', auth(member))
      .send({ version: 1, status: 'IN_PROGRESS', assigneeId: member.id }).expect(200);
    await request(app.getHttpServer()).put(`${path(orgA)}/${id}`).set('Authorization', auth(member))
      .send({ version: 2 }).expect(200);
    await request(app.getHttpServer()).post(`${path(orgA)}/${id}/comments`).set('Authorization', auth(admin))
      .send({ body: 'Comentário no histórico' }).expect(201);

    const history = await request(app.getHttpServer()).get(`${path(orgA)}/${id}/activity`)
      .set('Authorization', auth(member)).expect(200);
    expect(history.body.data.map((item: { type: string }) => item.type)).toEqual(['COMMENT_ADDED', 'TASK_UPDATED', 'TASK_CREATED']);
    expect(history.body.data[1]).toMatchObject({
      actor: { id: member.id },
      changes: [
        { field: 'status', from: 'TODO', to: 'IN_PROGRESS' },
        { field: 'assignee', from: null, to: 'Test member' },
      ],
    });
    expect(JSON.stringify(history.body)).not.toContain('Comentário no histórico');

    await request(app.getHttpServer()).get(`${path(orgA)}/${id}/activity`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${orgA}/activity`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).get(`${path(orgA)}/${taskB}/activity`).set('Authorization', auth(owner)).expect(404);

    await request(app.getHttpServer()).delete(`${path(orgA)}/${id}?version=3`).set('Authorization', auth(owner)).expect(204);
    const feed = await request(app.getHttpServer()).get(`/organizations/${orgA}/activity?limit=5`)
      .set('Authorization', auth(member)).expect(200);
    expect(feed.body.data[0]).toMatchObject({ type: 'TASK_DELETED', taskId: null, taskTitle: 'History task', actor: { id: owner.id } });
    expect(feed.body.data.filter((item: { taskTitle: string }) => item.taskTitle === 'History task')
      .every((item: { taskId: string | null }) => item.taskId === null)).toBe(true);
    const otherFeed = await request(app.getHttpServer()).get(`/organizations/${orgB}/activity`)
      .set('Authorization', auth(other)).expect(200);
    expect(otherFeed.body.data.some((item: { taskTitle: string }) => item.taskTitle === 'History task')).toBe(false);
    const older = await request(app.getHttpServer()).get(`/organizations/${orgA}/activity?limit=1&before=${feed.body.data[0].id}`)
      .set('Authorization', auth(member)).expect(200);
    expect(older.body.data[0].id).toBe(feed.body.data[1].id);
  });

  it('notifies assignees and task participants, never the actor, and only while they are members', async () => {
    const notified = await register('notified');
    await request(app.getHttpServer()).post(`/organizations/${orgA}/members`).set('Authorization', auth(owner))
      .send({ email: notified.email, role: 'MEMBER' }).expect(201);
    const title = `Notified task ${runId}`;
    const task = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title, assigneeId: notified.id }).expect(201);
    const selfAssigned = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: `Self assigned ${runId}`, assigneeId: owner.id }).expect(201);
    await request(app.getHttpServer()).post(`${path(orgA)}/${task.body.id}/comments`).set('Authorization', auth(admin))
      .send({ body: 'Acompanhando' }).expect(201);

    const mine = (user: TestUser, query = '') => request(app.getHttpServer()).get(`/notifications${query}`).set('Authorization', auth(user));
    const received = await mine(notified).expect(200);
    expect(received.body.data.map((item: { type: string }) => item.type)).toEqual(['TASK_COMMENTED', 'TASK_ASSIGNED']);
    expect(received.body).toMatchObject({ unreadCount: 2, nextCursor: null });
    expect(received.body.data[1]).toMatchObject({
      taskId: task.body.id, taskTitle: title, readAt: null, actor: { id: owner.id }, organization: { id: orgA },
    });
    const ownerNotifications = (await mine(owner, '?limit=50').expect(200)).body.data as { taskTitle: string; type: string }[];
    expect(ownerNotifications.filter((item) => item.taskTitle === title).map((item) => item.type)).toEqual(['TASK_COMMENTED']);
    expect(ownerNotifications.some((item) => item.taskTitle === `Self assigned ${runId}`)).toBe(false);
    const adminNotifications = (await mine(admin, '?limit=50').expect(200)).body.data as { taskTitle: string }[];
    expect(adminNotifications.some((item) => item.taskTitle === title)).toBe(false);

    const first = received.body.data[0].id as string;
    await request(app.getHttpServer()).post(`/notifications/${first}/read`).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).post(`/notifications/${first}/read`).set('Authorization', auth(notified)).expect(204);
    await request(app.getHttpServer()).post(`/notifications/${first}/read`).set('Authorization', auth(notified)).expect(204);
    expect((await mine(notified, '?unread=true').expect(200)).body).toMatchObject({ unreadCount: 1, data: [{ type: 'TASK_ASSIGNED' }] });
    await request(app.getHttpServer()).post('/notifications/read-all').set('Authorization', auth(notified)).expect(204);
    expect((await mine(notified).expect(200)).body.unreadCount).toBe(0);

    await prisma.membership.delete({ where: { organizationId_userId: { organizationId: orgA, userId: notified.id } } });
    expect((await mine(notified).expect(200)).body).toEqual({ data: [], nextCursor: null, unreadCount: 0 });

    // Remove as tarefas criadas aqui para não afetar as contagens dos demais testes.
    for (const id of [task.body.id, selfAssigned.body.id]) {
      await request(app.getHttpServer()).delete(`${path(orgA)}/${id}?version=1`).set('Authorization', auth(owner)).expect(204);
    }
  });

  it('manages projects per tenant, filters tasks by project and keeps tasks when a project is deleted', async () => {
    const projects = (org: string) => `/organizations/${org}/projects`;
    await request(app.getHttpServer()).post(projects(orgA)).set('Authorization', auth(member)).send({ name: 'Bloqueado' }).expect(403);
    const created = await request(app.getHttpServer()).post(projects(orgA)).set('Authorization', auth(admin))
      .send({ name: ` Site ${runId} `, description: 'Novo site' }).expect(201);
    expect(created.body).toMatchObject({ name: `Site ${runId}`, taskCount: 0, organizationId: orgA });
    await request(app.getHttpServer()).post(projects(orgA)).set('Authorization', auth(owner)).send({ name: `Site ${runId}` }).expect(409);
    const foreign = await request(app.getHttpServer()).post(projects(orgB)).set('Authorization', auth(other))
      .send({ name: `Outro ${runId}` }).expect(201);
    await request(app.getHttpServer()).get(projects(orgB)).set('Authorization', auth(owner)).expect(404);
    await request(app.getHttpServer()).get(`${projects(orgA)}/${foreign.body.id}`).set('Authorization', auth(owner)).expect(404);

    await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Cross project task', projectId: foreign.body.id }).expect(400);
    const inProject = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(member))
      .send({ title: 'Project task', projectId: created.body.id }).expect(201);
    expect(inProject.body.projectId).toBe(created.body.id);
    await request(app.getHttpServer()).put(`${path(orgA)}/${inProject.body.id}`).set('Authorization', auth(member))
      .send({ version: 1, projectId: foreign.body.id }).expect(400);

    const filtered = await request(app.getHttpServer()).get(`${path(orgA)}?projectId=${created.body.id}`)
      .set('Authorization', auth(member)).expect(200);
    expect(filtered.body.data.map((task: { id: string }) => task.id)).toEqual([inProject.body.id]);
    expect(filtered.body.data[0].project).toEqual({ id: created.body.id, name: `Site ${runId}` });
    const listed = await request(app.getHttpServer()).get(projects(orgA)).set('Authorization', auth(member)).expect(200);
    expect(listed.body.find((item: { id: string }) => item.id === created.body.id)).toMatchObject({ taskCount: 1 });

    const renamed = await request(app.getHttpServer()).patch(`${projects(orgA)}/${created.body.id}`).set('Authorization', auth(owner))
      .send({ name: `Portal ${runId}`, description: null }).expect(200);
    expect(renamed.body).toMatchObject({ name: `Portal ${runId}`, description: null });
    const moved = await request(app.getHttpServer()).put(`${path(orgA)}/${inProject.body.id}`).set('Authorization', auth(member))
      .send({ version: 1, projectId: null }).expect(200);
    expect(moved.body.project).toBeNull();
    const history = await request(app.getHttpServer()).get(`${path(orgA)}/${inProject.body.id}/activity`)
      .set('Authorization', auth(member)).expect(200);
    expect(history.body.data[0].changes).toEqual([{ field: 'project', from: `Portal ${runId}`, to: null }]);

    await request(app.getHttpServer()).put(`${path(orgA)}/${inProject.body.id}`).set('Authorization', auth(member))
      .send({ version: 2, projectId: created.body.id }).expect(200);
    await request(app.getHttpServer()).delete(`${projects(orgA)}/${created.body.id}`).set('Authorization', auth(member)).expect(403);
    await request(app.getHttpServer()).delete(`${projects(orgA)}/${created.body.id}`).set('Authorization', auth(admin)).expect(204);
    const kept = await request(app.getHttpServer()).get(`${path(orgA)}/${inProject.body.id}`).set('Authorization', auth(member)).expect(200);
    expect(kept.body).toMatchObject({ projectId: null, project: null });
    await request(app.getHttpServer()).delete(`${path(orgA)}/${inProject.body.id}?version=${kept.body.version}`)
      .set('Authorization', auth(owner)).expect(204);
  });

  it('stores attachments in S3, serves them by signed URL inside the tenant and cleans them up', async () => {
    const attachments = (task: string) => `${path(orgA)}/${task}/attachments`;
    const objectExists = async (key: string) => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    };
    const task = await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner))
      .send({ title: 'Task with files' }).expect(201);
    const pdf = Buffer.from(`%PDF-1.7\nconteúdo ${runId}\n`);
    const uploaded = await request(app.getHttpServer()).post(attachments(task.body.id)).set('Authorization', auth(member))
      .attach('file', pdf, { filename: 'relatório final.pdf', contentType: 'text/html' }).expect(201);
    expect(uploaded.body).toMatchObject({
      fileName: 'relatório final.pdf', contentType: 'application/pdf', size: pdf.length, uploader: { id: member.id },
    });
    const stored = await prisma.taskAttachment.findUniqueOrThrow({ where: { id: uploaded.body.id } });
    expect(stored.storageKey).toBe(`organizations/${orgA}/tasks/${task.body.id}/${uploaded.body.id}`);
    expect(await objectExists(stored.storageKey)).toBe(true);

    await request(app.getHttpServer()).post(attachments(task.body.id)).set('Authorization', auth(owner))
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'desenho.svg').expect(415);
    await request(app.getHttpServer()).get(attachments(task.body.id)).set('Authorization', auth(other)).expect(404);
    await request(app.getHttpServer()).get(`${path(orgB)}/${taskB}/attachments/${uploaded.body.id}/download`)
      .set('Authorization', auth(other)).expect(404);

    const link = await request(app.getHttpServer()).get(`${attachments(task.body.id)}/${uploaded.body.id}/download`)
      .set('Authorization', auth(admin)).expect(200);
    const downloaded = await fetch(link.body.url);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer()).equals(pdf)).toBe(true);
    expect(downloaded.headers.get('content-type')).toBe('application/pdf');
    expect(downloaded.headers.get('content-disposition')).toContain("filename*=UTF-8''relat%C3%B3rio%20final.pdf");
    expect((await fetch(link.body.url.replace(uploaded.body.id, randomUUID()))).status).toBe(403);
    expect((await fetch(`${process.env.S3_ENDPOINT}/${s3Bucket}/${stored.storageKey}`)).status).toBe(403);

    await request(app.getHttpServer()).delete(`${attachments(task.body.id)}/${uploaded.body.id}`)
      .set('Authorization', auth(candidate)).expect(404);
    const second = await request(app.getHttpServer()).post(attachments(task.body.id)).set('Authorization', auth(owner))
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'foto.png').expect(201);
    await request(app.getHttpServer()).delete(`${attachments(task.body.id)}/${second.body.id}`)
      .set('Authorization', auth(member)).expect(403);
    await request(app.getHttpServer()).delete(`${attachments(task.body.id)}/${uploaded.body.id}`)
      .set('Authorization', auth(member)).expect(204);
    expect(await objectExists(stored.storageKey)).toBe(false);
    const history = await request(app.getHttpServer()).get(`${path(orgA)}/${task.body.id}/activity`)
      .set('Authorization', auth(owner)).expect(200);
    expect(history.body.data.slice(0, 3).map((item: { type: string }) => item.type))
      .toEqual(['ATTACHMENT_REMOVED', 'ATTACHMENT_ADDED', 'ATTACHMENT_ADDED']);

    const secondKey = (await prisma.taskAttachment.findUniqueOrThrow({ where: { id: second.body.id } })).storageKey;
    await request(app.getHttpServer()).delete(`${path(orgA)}/${task.body.id}?version=1`).set('Authorization', auth(owner)).expect(204);
    expect(await prisma.taskAttachment.count({ where: { taskId: task.body.id } })).toBe(0);
    expect(await objectExists(secondKey)).toBe(false);
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

  it('runs the mobile session with the refresh token in the body', async () => {
    const http = () => request(app.getHttpServer());
    const login = await http().post('/auth/mobile/login').send({ email: member.email, password }).expect(200);
    expect(login.headers['set-cookie']).toBeUndefined();
    const first = login.body.refreshToken as string;
    const rotated = await http().post('/auth/mobile/refresh').send({ refreshToken: first }).expect(200);
    expect(rotated.body.refreshToken).not.toBe(first);
    await http().get('/auth/me').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(200);
    await http().post('/auth/mobile/logout').send({ refreshToken: rotated.body.refreshToken }).expect(204);
    await http().post('/auth/mobile/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
  });

  it('creates a task idempotently with a client-generated id', async () => {
    const id = randomUUID();
    const body = { id, title: 'Criada offline', status: 'TODO' };
    const results = await Promise.all([1, 2].map(() =>
      request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(member)).send(body)));
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results.map((result) => result.body.id)).toEqual([id, id]);
    expect(await prisma.task.count({ where: { id } })).toBe(1);
    expect(await prisma.taskActivity.count({ where: { taskId: id, type: 'TASK_CREATED' } })).toBe(1);
    await request(app.getHttpServer()).post(path(orgA)).set('Authorization', auth(owner)).send(body).expect(409);
    await request(app.getHttpServer()).post(path(orgB)).set('Authorization', auth(other)).send(body).expect(409);
    await prisma.task.delete({ where: { id } });
  });

  it('enforces plan limits atomically and reports usage', async () => {
    const http = () => request(app.getHttpServer());
    const planOwner = await register('plan-owner');
    const org = await organization(planOwner, 'Plan limits');
    const overview = await http().get(`/organizations/${org}/plan`).set('Authorization', auth(planOwner)).expect(200);
    expect(overview.body).toMatchObject({
      plan: 'FREE', limits: PLANS.FREE.limits, usage: { members: 1, projects: 0, tasks: 0, storageBytes: 0 },
    });
    await http().get(`/organizations/${org}/plan`).set('Authorization', auth(other)).expect(404);
    const catalog = await http().get('/plans').set('Authorization', auth(planOwner)).expect(200);
    expect(catalog.body.map((plan: { id: string }) => plan.id)).toEqual(['FREE', 'PRO', 'BUSINESS']);

    // Membros: limite 5. Com 4 membros, de duas adições simultâneas só uma entra.
    const invitees = await Promise.all([1, 2, 3, 4, 5].map((index) => register(`plan-member-${index}`)));
    for (const invitee of invitees.slice(0, 3)) {
      await http().post(`/organizations/${org}/members`).set('Authorization', auth(planOwner))
        .send({ email: invitee.email, role: 'MEMBER' }).expect(201);
    }
    const memberResults = await Promise.all(invitees.slice(3).map((invitee) =>
      http().post(`/organizations/${org}/members`).set('Authorization', auth(planOwner)).send({ email: invitee.email, role: 'MEMBER' })));
    expect(memberResults.map((result) => result.status).sort((a, b) => a - b)).toEqual([201, 403]);
    expect(memberResults.find((result) => result.status === 403)?.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', limit: 'members', plan: 'FREE' });
    expect(await prisma.membership.count({ where: { organizationId: org } })).toBe(PLANS.FREE.limits.members);

    // Projetos: limite 3, mesmo com cinco criações simultâneas.
    const projectResults = await Promise.all([1, 2, 3, 4, 5].map((index) =>
      http().post(`/organizations/${org}/projects`).set('Authorization', auth(planOwner)).send({ name: `Projeto ${index}` })));
    expect(projectResults.filter((result) => result.status === 201)).toHaveLength(PLANS.FREE.limits.projects!);
    expect(projectResults.filter((result) => result.status === 403)).toHaveLength(2);

    // Tarefas: com uma vaga restante, três criações simultâneas resultam em uma.
    await prisma.task.createMany({
      data: Array.from({ length: PLANS.FREE.limits.tasks! - 1 }, (_, index) => ({
        organizationId: org, creatorId: planOwner.id, title: `Carga ${index}`,
      })),
    });
    const taskResults = await Promise.all([1, 2, 3].map((index) =>
      http().post(path(org)).set('Authorization', auth(planOwner)).send({ title: `Concorrente ${index}` })));
    expect(taskResults.map((result) => result.status).sort((a, b) => a - b)).toEqual([201, 403, 403]);
    expect(await prisma.task.count({ where: { organizationId: org } })).toBe(PLANS.FREE.limits.tasks);

    // Armazenamento: arquivo acima do limite do plano e cota esgotada.
    const taskId = taskResults.find((result) => result.status === 201)?.body.id as string;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const attachments = `${path(org)}/${taskId}/attachments`;
    const big = Buffer.concat([png, Buffer.alloc(PLANS.FREE.limits.maxFileBytes)]);
    const tooBig = await http().post(attachments).set('Authorization', auth(planOwner)).attach('file', big, 'grande.png').expect(403);
    expect(tooBig.body).toMatchObject({ limit: 'fileSize' });
    await prisma.taskAttachment.create({ data: {
      organizationId: org, taskId, uploaderId: planOwner.id, fileName: 'cota.bin', contentType: 'application/zip',
      size: PLANS.FREE.limits.storageBytes - 5, storageKey: `integration/${runId}/quota`,
    } });
    const full = await http().post(attachments).set('Authorization', auth(planOwner)).attach('file', png, 'foto.png').expect(403);
    expect(full.body).toMatchObject({ limit: 'storage' });
    expect(await prisma.taskAttachment.count({ where: { organizationId: org } })).toBe(1);
    await prisma.taskAttachment.deleteMany({ where: { organizationId: org } });

    // Organizações gratuitas por proprietário; uma organização paga não conta.
    for (let index = 1; index < FREE_ORGANIZATIONS_PER_OWNER; index++) await organization(planOwner, `Plan extra ${index}`);
    const refused = await http().post('/organizations').set('Authorization', auth(planOwner)).send({ name: `Plan refused ${runId}` }).expect(403);
    expect(refused.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', limit: 'freeOrganizations' });

    // Ao passar para o plano Profissional, os limites aumentam sem perder dados.
    await prisma.organization.update({ where: { id: org }, data: { plan: 'PRO', planChangedAt: new Date() } });
    await http().post(`/organizations/${org}/projects`).set('Authorization', auth(planOwner)).send({ name: 'Projeto pago' }).expect(201);
    await http().post(path(org)).set('Authorization', auth(planOwner)).send({ title: 'Tarefa paga' }).expect(201);
    await organization(planOwner, 'Plan after upgrade');
    const upgraded = await http().get(`/organizations/${org}/plan`).set('Authorization', auth(planOwner)).expect(200);
    expect(upgraded.body).toMatchObject({ plan: 'PRO', usage: { members: 5, projects: 4, tasks: PLANS.FREE.limits.tasks! + 1 } });
  });

  it('changes plans only after the simulated payment is confirmed', async () => {
    const http = () => request(app.getHttpServer());
    const billingOwner = await register('billing-owner');
    const billingMember = await register('billing-member');
    const org = await organization(billingOwner, 'Billing');
    await http().post(`/organizations/${org}/members`).set('Authorization', auth(billingOwner))
      .send({ email: billingMember.email, role: 'MEMBER' }).expect(201);
    const base = `/organizations/${org}/billing`;
    const plan = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: org } })).plan;
    const complete = (id: string, outcome: string, user = billingOwner) =>
      http().post(`/billing/fake/checkouts/${id}/complete`).set('Authorization', auth(user)).send({ outcome });

    await http().post(`${base}/checkouts`).set('Authorization', auth(billingMember)).send({ plan: 'PRO' }).expect(403);
    await http().post(`${base}/checkouts`).set('Authorization', auth(other)).send({ plan: 'PRO' }).expect(404);
    await http().post(`${base}/checkouts`).set('Authorization', auth(billingOwner)).send({ plan: 'FREE' }).expect(400);

    // Pagamento recusado: nada muda e o checkout não pode mais ser aprovado.
    const declined = await http().post(`${base}/checkouts`).set('Authorization', auth(billingOwner)).send({ plan: 'PRO' }).expect(201);
    expect(declined.body).toMatchObject({ status: 'PENDING', planName: 'Profissional', checkoutUrl: `/plan/checkout/${declined.body.id}` });
    await complete(declined.body.id, 'approve', billingMember).expect(403);
    expect((await complete(declined.body.id, 'decline').expect(200)).body.status).toBe('FAILED');
    await complete(declined.body.id, 'approve').expect(409);
    expect(await plan()).toBe('FREE');

    // Um pedido novo cancela o anterior pendente.
    const abandoned = await http().post(`${base}/checkouts`).set('Authorization', auth(billingOwner)).send({ plan: 'BUSINESS' }).expect(201);
    const paid = await http().post(`${base}/checkouts`).set('Authorization', auth(billingOwner)).send({ plan: 'PRO' }).expect(201);
    expect((await http().get(`${base}/checkouts/${abandoned.body.id}`).set('Authorization', auth(billingOwner)).expect(200)).body.status).toBe('CANCELED');

    // Aprovações simultâneas: uma única troca de plano registrada.
    const approvals = await Promise.all([1, 2].map(() => complete(paid.body.id, 'approve')));
    expect(approvals.map((result) => result.status)).toEqual([200, 200]);
    expect(approvals.map((result) => result.body.status)).toEqual(['PAID', 'PAID']);
    expect(await plan()).toBe('PRO');
    expect(await prisma.planChange.count({ where: { organizationId: org } })).toBe(1);

    await http().post(`${base}/checkouts`).set('Authorization', auth(billingOwner)).send({ plan: 'PRO' }).expect(409);

    // Checkout expirado.
    const late = await http().post(`${base}/checkouts`).set('Authorization', auth(billingOwner)).send({ plan: 'BUSINESS' }).expect(201);
    await prisma.billingCheckout.update({ where: { id: late.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await complete(late.body.id, 'approve').expect(409);
    expect((await http().get(`${base}/checkouts/${late.body.id}`).set('Authorization', auth(billingOwner)).expect(200)).body.status).toBe('EXPIRED');
    expect(await plan()).toBe('PRO');

    // Volta ao Gratuito, com histórico visível ao proprietário e oculto ao membro.
    await http().post(`${base}/cancel`).set('Authorization', auth(billingMember)).expect(403);
    expect((await http().post(`${base}/cancel`).set('Authorization', auth(billingOwner)).expect(200)).body.plan).toBe('FREE');
    await http().post(`${base}/cancel`).set('Authorization', auth(billingOwner)).expect(409);
    const overview = await http().get(base).set('Authorization', auth(billingOwner)).expect(200);
    expect(overview.body).toMatchObject({ provider: 'fake', canManage: true });
    expect(overview.body.history.map((item: { fromPlan: string; toPlan: string }) => `${item.fromPlan}>${item.toPlan}`)).toEqual(['PRO>FREE', 'FREE>PRO']);
    expect((await http().get(base).set('Authorization', auth(billingMember)).expect(200)).body.history).toEqual([]);
  });

  it('recovers a password through a single-use e-mailed link', async () => {
    const http = () => request(app.getHttpServer());
    const forgetful = await register('forgetful');
    const mails = () => readdirSync(outbox).filter((file) => file.endsWith('.eml'));
    const waitFor = async (check: () => Promise<boolean>) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timeout waiting for the reset e-mail');
    };
    const tokenFrom = (file: string) => /reset-password#token=([\w-]+)/.exec(readFileSync(join(outbox, file), 'utf8'))?.[1] ?? '';

    // E-mail inexistente: mesma resposta e nada enviado.
    const unknown = await http().post('/auth/password/forgot').send({ email: `nobody-${runId}@example.test` }).expect(202);
    const before = mails().length;
    const sessionCookie = await loginWithCookie(forgetful.email);
    const mobile = await http().post('/auth/mobile/login').send({ email: forgetful.email, password }).expect(200);

    const known = await http().post('/auth/password/forgot').send({ email: forgetful.email.toUpperCase() }).expect(202);
    expect(known.body).toEqual(unknown.body);
    await waitFor(async () => mails().length === before + 1);
    const file = mails().find((name) => readFileSync(join(outbox, name), 'utf8').includes(`To: ${forgetful.email}`))!;
    const token = tokenFrom(file);
    expect(token).toHaveLength(43);
    expect(await prisma.passwordResetToken.count({ where: { userId: forgetful.id } })).toBe(1);
    expect((await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: forgetful.id } })).tokenHash).not.toContain(token);

    // Novo pedido logo em seguida: nenhum e-mail novo (intervalo mínimo).
    await http().post('/auth/password/forgot').send({ email: forgetful.email }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mails().length).toBe(before + 1);

    await http().post('/auth/password/reset').send({ token: 'x'.repeat(43), newPassword: 'nova-senha-bem-longa' }).expect(400);
    await http().post('/auth/password/reset').send({ token, newPassword: 'curta' }).expect(400);

    // Conta bloqueada por tentativas é liberada pela redefinição.
    await prisma.user.update({ where: { id: forgetful.id }, data: { lockedUntil: new Date(Date.now() + 600_000), failedLoginAttempts: 5 } });
    const results = await Promise.all([1, 2].map(() =>
      http().post('/auth/password/reset').send({ token, newPassword: 'nova-senha-bem-longa' })));
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([204, 400]);

    // Todas as sessões anteriores terminam.
    await http().get('/auth/me').set('Authorization', auth(forgetful)).expect(401);
    await refresh(sessionCookie).expect(401);
    await http().post('/auth/mobile/refresh').send({ refreshToken: mobile.body.refreshToken }).expect(401);
    await http().post('/auth/login').send({ email: forgetful.email, password }).expect(401);
    await http().post('/auth/login').send({ email: forgetful.email, password: 'nova-senha-bem-longa' }).expect(201);
    await http().post('/auth/password/reset').send({ token, newPassword: 'outra-senha-bem-longa' }).expect(400);

    // Link vencido.
    await prisma.passwordResetToken.deleteMany({ where: { userId: forgetful.id } });
    await http().post('/auth/password/forgot').send({ email: forgetful.email }).expect(202);
    await waitFor(async () => (await prisma.passwordResetToken.count({ where: { userId: forgetful.id, usedAt: null } })) === 1);
    await waitFor(async () => mails().length === before + 2);
    const late = tokenFrom(mails().filter((name) => name !== file).sort().at(-1)!);
    await prisma.passwordResetToken.updateMany({ where: { userId: forgetful.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post('/auth/password/reset').send({ token: late, newPassword: 'outra-senha-bem-longa' }).expect(400);
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
