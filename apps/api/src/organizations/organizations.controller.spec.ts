import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller.js';
import { MobileAuthController } from '../auth/mobile-auth.controller.js';
import { AuthService } from '../auth/auth.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ConfigService } from '@nestjs/config';
import { REFRESH_COOKIE, RefreshCookieService, RefreshRequestGuard } from '../auth/refresh-cookie.js';
import { RefreshTokensService } from '../auth/refresh-tokens.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlansService } from '../plans/plans.service.js';
import { TasksController } from '../tasks/tasks.controller.js';
import { TasksService } from '../tasks/tasks.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

describe('Authenticated HTTP endpoints', () => {
  const storage = { deleteQuietly: vi.fn().mockResolvedValue(undefined), isConfigured: () => false };
  const orgId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  let app: INestApplication;
  let token: string;
  let refreshTokens: {
    issue: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    revokeFamilyOf: ReturnType<typeof vi.fn>;
    revokeAllForUser: ReturnType<typeof vi.fn>;
  };
  const refreshExpiry = new Date('2030-01-01T00:00:00Z');
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    organization: { update: ReturnType<typeof vi.fn> };
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    task: { create: ReturnType<typeof vi.fn> };
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    refreshTokens = {
      issue: vi.fn().mockResolvedValue({ id: 'r1', token: 'issued-refresh', expiresAt: refreshExpiry }),
      rotate: vi.fn(),
      revokeFamilyOf: vi.fn().mockResolvedValue(undefined),
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      membership: { findUnique: vi.fn(), findMany: vi.fn() },
      organization: { update: vi.fn() },
      $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
      task: { create: vi.fn() },
      // O guard JWT consulta a versão de sessão do usuário do token.
      user: { findUnique: vi.fn().mockResolvedValue({ sessionVersion: 0 }), create: vi.fn(), update: vi.fn() },
    };
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test-only-signing-key-not-used-in-production' }),
        ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 3 }]),
      ],
      controllers: [AuthController, MobileAuthController, OrganizationsController, TasksController],
      providers: [
        AuthService, OrganizationsService, TasksService, JwtAuthGuard,
        RefreshCookieService, RefreshRequestGuard,
        { provide: ObjectStorageService, useValue: storage },
        { provide: NotificationsService, useValue: { notify: vi.fn().mockResolvedValue(undefined) } },
        { provide: ActivityService, useValue: { record: vi.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: RefreshTokensService, useValue: refreshTokens },
        { provide: PlansService, useValue: { assertCanCreate: vi.fn(), assertCanStore: vi.fn(), assertCanOwnFreeOrganization: vi.fn() } },
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

  describe('mobile session', () => {
    it('returns the refresh token in the body without setting a cookie', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: userId, name: 'User', email: 'user@example.test', sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
        passwordHash: await argon2.hash('valid-test-password', { type: argon2.argon2id }),
      });
      const response = await request(app.getHttpServer()).post('/auth/mobile/login')
        .send({ email: 'user@example.test', password: 'valid-test-password' }).expect(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String), tokenType: 'Bearer', refreshToken: 'issued-refresh',
        refreshExpiresAt: refreshExpiry.toISOString(), user: { id: userId },
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('rotates and revokes the token received in the body', async () => {
      const valid = 'old-refresh-token-0123456789';
      await request(app.getHttpServer()).post('/auth/mobile/refresh').send({}).expect(400);
      await request(app.getHttpServer()).post('/auth/mobile/refresh').send({ refreshToken: 'short' }).expect(400);
      refreshTokens.rotate.mockResolvedValueOnce({
        user: { id: userId, name: 'User', email: 'user@example.test' }, sessionVersion: 0,
        refreshToken: { token: 'rotated-refresh', expiresAt: refreshExpiry },
      });
      const rotated = await request(app.getHttpServer()).post('/auth/mobile/refresh').send({ refreshToken: valid }).expect(200);
      expect(refreshTokens.rotate).toHaveBeenCalledWith(valid);
      expect(rotated.body).toMatchObject({ refreshToken: 'rotated-refresh', user: { id: userId } });

      const { UnauthorizedException } = await import('@nestjs/common');
      refreshTokens.rotate.mockRejectedValueOnce(new UnauthorizedException());
      await request(app.getHttpServer()).post('/auth/mobile/refresh').send({ refreshToken: valid }).expect(401);

      await request(app.getHttpServer()).post('/auth/mobile/logout').send({ refreshToken: valid }).expect(204);
      expect(refreshTokens.revokeFamilyOf).toHaveBeenCalledWith(valid);
    });
  });

  describe('refresh cookie', () => {
    const header = { 'X-TaskFlow-Request': '1' };
    const cookie = (response: request.Response): string =>
      ([] as string[]).concat(response.headers['set-cookie'] ?? []).find((item) => item.startsWith(`${REFRESH_COOKIE}=`)) ?? '';

    it('sets an HttpOnly, Secure, SameSite=Strict cookie on login without exposing it in the body', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: userId, name: 'User', email: 'user@example.test', sessionVersion: 0, failedLoginAttempts: 0, lockedUntil: null,
        passwordHash: await argon2.hash('valid-test-password', { type: argon2.argon2id }),
      });
      const response = await request(app.getHttpServer()).post('/auth/login')
        .send({ email: 'user@example.test', password: 'valid-test-password' }).expect(201);
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.accessToken).toEqual(expect.any(String));
      const value = cookie(response);
      expect(value).toContain(`${REFRESH_COOKIE}=issued-refresh`);
      expect(value).toMatch(/HttpOnly/i);
      expect(value).toMatch(/Secure/i);
      expect(value).toMatch(/SameSite=Strict/i);
      expect(value).toMatch(/Path=\/auth/i);
    });

    it('requires the request header before reading the cookie', async () => {
      await request(app.getHttpServer()).post('/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=abc`).expect(403);
      await request(app.getHttpServer()).post('/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE}=abc`).expect(403);
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
      expect(refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
    });

    it('rotates the cookie on refresh and clears it when the session is invalid', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').set(header).expect(401);
      refreshTokens.rotate.mockResolvedValueOnce({
        user: { id: userId, name: 'User', email: 'user@example.test' }, sessionVersion: 0,
        refreshToken: { token: 'rotated-refresh', expiresAt: refreshExpiry },
      });
      const ok = await request(app.getHttpServer()).post('/auth/refresh').set(header)
        .set('Cookie', `other=1; ${REFRESH_COOKIE}=old-refresh`).expect(200);
      expect(refreshTokens.rotate).toHaveBeenCalledWith('old-refresh');
      expect(ok.body).toMatchObject({ tokenType: 'Bearer', user: { id: userId } });
      expect(cookie(ok)).toContain(`${REFRESH_COOKIE}=rotated-refresh`);

      const { UnauthorizedException, ConflictException } = await import('@nestjs/common');
      refreshTokens.rotate.mockRejectedValueOnce(new UnauthorizedException());
      const denied = await request(app.getHttpServer()).post('/auth/refresh').set(header)
        .set('Cookie', `${REFRESH_COOKIE}=stale`).expect(401);
      expect(cookie(denied)).toMatch(new RegExp(`${REFRESH_COOKIE}=;`));
      refreshTokens.rotate.mockRejectedValueOnce(new ConflictException());
      const concurrent = await request(app.getHttpServer()).post('/auth/refresh').set(header)
        .set('Cookie', `${REFRESH_COOKIE}=racing`).expect(409);
      expect(cookie(concurrent)).toBe('');
    });

    it('logs out by revoking the cookie session and clearing it', async () => {
      const response = await request(app.getHttpServer()).post('/auth/logout').set(header)
        .set('Cookie', `${REFRESH_COOKIE}=current`).expect(204);
      expect(refreshTokens.revokeFamilyOf).toHaveBeenCalledWith('current');
      expect(cookie(response)).toMatch(new RegExp(`${REFRESH_COOKIE}=;`));
    });
  });
});
