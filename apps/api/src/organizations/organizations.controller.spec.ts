import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService } from '../auth/auth.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksController } from '../tasks/tasks.controller.js';
import { TasksService } from '../tasks/tasks.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

describe('Authenticated HTTP endpoints', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  let app: INestApplication;
  let token: string;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    organization: { update: ReturnType<typeof vi.fn> };
    task: { create: ReturnType<typeof vi.fn> };
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn(), findMany: vi.fn() },
      organization: { update: vi.fn() },
      task: { create: vi.fn() },
      // O guard JWT consulta a versão de sessão do usuário do token.
      user: { findUnique: vi.fn().mockResolvedValue({ sessionVersion: 0 }), create: vi.fn(), update: vi.fn() },
    };
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test-only-signing-key-not-used-in-production' }),
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 3 }]),
      ],
      controllers: [AuthController, OrganizationsController, TasksController],
      providers: [
        AuthService, OrganizationsService, TasksService, JwtAuthGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = await app.get(JwtService).signAsync({ sub: userId });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated task creation', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .send({ title: 'Valid task' }).expect(401);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('rejects expired tokens', async () => {
    const expiredToken = await app.get(JwtService).signAsync({ sub: userId }, { expiresIn: -1 });
    await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${expiredToken}`).expect(401);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/organizations/not-a-uuid/members'],
    ['post', '/organizations/not-a-uuid/members'],
    ['post', '/organizations/not-a-uuid/tasks'],
  ] as const)('rejects invalid UUIDs on %s %s', async (method, path) => {
    const body = path.endsWith('/tasks')
      ? { title: 'Valid task' }
      : { email: 'member@example.test', role: 'MEMBER' };
    await request(app.getHttpServer())[method](path)
      .set('Authorization', `Bearer ${token}`).send(body).expect(400);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('rejects names and titles which are too short after trimming', async () => {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ name: '   ', email: 'user@example.test', password: 'a-valid-test-password' }).expect(400);
    await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`).send({ name: ' x ' }).expect(400);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`).send({ title: '  ab  ' }).expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('normalizes registration fields without trimming the password', async () => {
    let passwordHash = '';
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }: {
      data: { name: string; email: string; passwordHash: string };
    }) => {
      expect(data.name).toBe('User');
      expect(data.email).toBe('user@example.test');
      passwordHash = data.passwordHash;
      return Promise.resolve({ id: userId, name: data.name, email: data.email });
    });
    await request(app.getHttpServer()).post('/auth/register')
      .send({ name: ' User ', email: ' USER@example.test ', password: '  password-with-spaces  ' })
      .expect(201);
    await expect(argon2.verify(passwordHash, '  password-with-spaces  ')).resolves.toBe(true);
    await expect(argon2.verify(passwordHash, 'password-with-spaces')).resolves.toBe(false);
  });

  it('rejects a client-supplied creator and a cross-tenant requester', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Valid task', creatorId: userId }).expect(400);
    prisma.membership.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`).send({ title: 'Valid task' }).expect(404);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('uses the JWT subject and normalized title for task creation', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.create.mockResolvedValue({ id: 'task' });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`).send({ title: '  Valid task  ' }).expect(201);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });

    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: orgId, creatorId: userId, title: 'Valid task' }),
    }));
  });

  it('rejects a task assignee who is not a member of the organization', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce({ id: 'membership' }).mockResolvedValueOnce(null);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Valid task', assigneeId: '33333333-3333-4333-8333-333333333333' }).expect(403);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('accepts a valid initial task status and rejects invalid or null values', async () => {
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.task.create.mockResolvedValue({ id: 'task' });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Valid task', status: 'IN_PROGRESS' }).expect(201);
    expect(prisma.task.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'IN_PROGRESS' }),
    }));
    for (const status of ['OTHER', null]) {
      await request(app.getHttpServer()).post(`/organizations/${orgId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Valid task', status }).expect(400);
    }
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });

  it('updates the profile name of the JWT subject and rejects other fields', async () => {
    prisma.user.update.mockResolvedValue({ id: userId, name: 'Novo Nome', email: 'a@example.test', createdAt: new Date() });
    await request(app.getHttpServer()).patch('/auth/me').send({ name: 'Novo Nome' }).expect(401);
    await request(app.getHttpServer()).patch('/auth/me')
      .set('Authorization', `Bearer ${token}`).send({ name: ' Novo Nome ' }).expect(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: userId }, data: { name: 'Novo Nome' },
    }));
    for (const body of [{ name: ' a ' }, { name: 'Nome', email: 'b@example.test' }, {}]) {
      await request(app.getHttpServer()).patch('/auth/me')
        .set('Authorization', `Bearer ${token}`).send(body).expect(400);
    }
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('renames an organization only for managers and validates the request', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}`).send({ name: 'Equipe' }).expect(401);
    await request(app.getHttpServer()).patch('/organizations/not-a-uuid')
      .set('Authorization', `Bearer ${token}`).send({ name: 'Equipe' }).expect(400);
    await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`).send({ name: 'Equipe', slug: 'outro' }).expect(400);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();

    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'MEMBER' });
    await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`).send({ name: 'Equipe' }).expect(403);
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`).send({ name: 'Equipe' }).expect(404);
    expect(prisma.organization.update).not.toHaveBeenCalled();

    prisma.membership.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
    prisma.organization.update.mockResolvedValue({ id: orgId, name: 'Equipe', slug: 'equipe', createdAt: new Date() });
    const response = await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`).send({ name: ' Equipe ' }).expect(200);
    expect(response.body).toMatchObject({ id: orgId, name: 'Equipe', slug: 'equipe', role: 'ADMIN' });
  });

  it('rate limits login attempts per client before checking credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    for (let attempt = 0; attempt < 3; attempt++) {
      await request(app.getHttpServer()).post('/auth/login')
        .send({ email: 'someone@example.test', password: 'wrong-password-123' }).expect(401);
    }
    await request(app.getHttpServer()).post('/auth/login')
      .send({ email: 'someone@example.test', password: 'wrong-password-123' }).expect(429);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(3);
    await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect((response) => {
      expect(response.status).not.toBe(429);
    });
  });

  it('rejects tokens whose session version was revoked or whose user no longer exists', async () => {
    const current = await app.get(JwtService).signAsync({ sub: userId, ver: 1 });
    prisma.membership.findMany.mockResolvedValue([]);
    prisma.membership.findUnique.mockResolvedValue({ id: 'membership' });
    prisma.user.findUnique.mockResolvedValue({ sessionVersion: 1 });
    await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${current}`).expect(200);
    await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`).expect(401);
    prisma.user.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${current}`).expect(401);
    const malformed = await app.get(JwtService).signAsync({ sub: userId, ver: 'x' });
    prisma.user.findUnique.mockResolvedValue({ sessionVersion: 0 });
    await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${malformed}`).expect(401);
  });

  it('validates password changes and exposes session revocation', async () => {
    for (const body of [{}, { currentPassword: 'x', newPassword: 'short' }, { currentPassword: 'x', newPassword: 'long-enough-password', extra: 1 }]) {
      await request(app.getHttpServer()).put('/auth/me/password')
        .set('Authorization', `Bearer ${token}`).send(body).expect(400);
    }
    await request(app.getHttpServer()).put('/auth/me/password')
      .send({ currentPassword: 'x', newPassword: 'long-enough-password' }).expect(401);
    prisma.user.update.mockResolvedValue({ id: userId });
    await request(app.getHttpServer()).delete('/auth/me/sessions').expect(401);
    await request(app.getHttpServer()).delete('/auth/me/sessions')
      .set('Authorization', `Bearer ${token}`).expect(204);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: userId }, data: { sessionVersion: { increment: 1 } },
    }));
  });
});
