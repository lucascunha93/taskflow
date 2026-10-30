import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
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
    task: { create: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn(), findMany: vi.fn() },
      task: { create: vi.fn() },
      user: { findUnique: vi.fn(), create: vi.fn() },
    };
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-only-signing-key-not-used-in-production' })],
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
});
