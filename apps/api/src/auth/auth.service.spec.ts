import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthService, LOGIN_LOCK_MS, MAX_FAILED_LOGINS } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  const password = 'valid-test-password';
  const user = { id: 'user', name: 'User', email: 'user@example.test' };

  beforeEach(async () => {
    prisma = { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() } };
    jwt = { signAsync: vi.fn().mockResolvedValue('signed-test-token') };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('registers a normalized user with an Argon2id hash and does not return the hash', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }: { data: { passwordHash: string } }) => {
      expect(data.passwordHash).toMatch(/^\$argon2id\$/);
      return Promise.resolve(user);
    });
    await expect(service.register({ name: ' User ', email: ' USER@example.test ', password }))
      .resolves.toEqual(user);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'User', email: user.email }),
      select: { id: true, name: true, email: true, createdAt: true },
    }));
  });

  it('rejects an already registered email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: user.id });
    await expect(service.register({ name: 'User', email: user.email, password }))
      .rejects.toMatchObject({ status: 409 });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('reports a conflicting concurrent registration', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: 'test',
    }));
    await expect(service.register({ name: 'User', email: user.email, password }))
      .rejects.toMatchObject({ status: 409 });
  });

  const stored = async (overrides: object = {}) => ({
    ...user,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    sessionVersion: 2,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  });

  it('rejects missing users and wrong passwords, counting failures for existing accounts', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(await stored());
    prisma.user.update.mockResolvedValue({ failedLoginAttempts: 1 });
    await expect(service.login({ email: user.email, password })).rejects.toMatchObject({ status: 401 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(service.login({ email: user.email, password: 'wrong-password' })).rejects.toMatchObject({ status: 401 });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('locks the account after the maximum number of consecutive failures', async () => {
    prisma.user.findUnique.mockResolvedValue(await stored({ failedLoginAttempts: MAX_FAILED_LOGINS - 1 }));
    prisma.user.update.mockResolvedValue({ failedLoginAttempts: MAX_FAILED_LOGINS });
    const before = Date.now();
    await expect(service.login({ email: user.email, password: 'wrong-password' })).rejects.toMatchObject({ status: 401 });
    const lock = prisma.user.updateMany.mock.calls[0]?.[0] as { where: object; data: { lockedUntil: Date } };
    expect(lock.where).toEqual({ id: user.id, failedLoginAttempts: { gte: MAX_FAILED_LOGINS } });
    expect(lock.data.lockedUntil.getTime()).toBeGreaterThanOrEqual(before + LOGIN_LOCK_MS);
  });

  it('rejects a locked account with 429 regardless of the password and without counting failures', async () => {
    prisma.user.findUnique.mockResolvedValue(await stored({ lockedUntil: new Date(Date.now() + 60_000) }));
    await expect(service.login({ email: user.email, password })).rejects.toMatchObject({ status: 429 });
    await expect(service.login({ email: user.email, password: 'wrong-password' })).rejects.toMatchObject({ status: 429 });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('accepts a login after the lock expires and resets the failure state', async () => {
    prisma.user.findUnique.mockResolvedValue(await stored({ failedLoginAttempts: 3, lockedUntil: new Date(Date.now() - 1) }));
    await expect(service.login({ email: user.email, password })).resolves.toMatchObject({ accessToken: 'signed-test-token' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('signs the authenticated user ID and excludes the password hash', async () => {
    prisma.user.findUnique.mockResolvedValue(await stored());
    await expect(service.login({ email: ' USER@example.test ', password })).resolves.toEqual({
      accessToken: 'signed-test-token', tokenType: 'Bearer', expiresIn: 900, user,
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: user.id, ver: 2 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects profile lookup when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile(user.id)).rejects.toMatchObject({ status: 401 });
  });

  it('updates only the trimmed name of the authenticated user without exposing the hash', async () => {
    const updated = { ...user, name: 'Novo Nome', createdAt: new Date() };
    prisma.user.update.mockResolvedValue(updated);
    await expect(service.updateProfile(user.id, { name: ' Novo Nome ' })).resolves.toEqual(updated);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { name: 'Novo Nome' },
      select: { id: true, name: true, email: true, createdAt: true },
    });
  });

  it('rejects a profile update when the user no longer exists', async () => {
    prisma.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', {
      code: 'P2025',
      clientVersion: 'test',
    }));
    await expect(service.updateProfile(user.id, { name: 'Nome' })).rejects.toMatchObject({ status: 401 });
  });

  describe('changePassword', () => {
    const newPassword = 'another-valid-password';

    it('verifies the current password, rotates the hash and revokes previous sessions', async () => {
      prisma.user.findUnique.mockResolvedValue(await stored());
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.changePassword(user.id, { currentPassword: password, newPassword }))
        .resolves.toMatchObject({ accessToken: 'signed-test-token', user });
      const call = prisma.user.updateMany.mock.calls[0]?.[0] as {
        where: object; data: { passwordHash: string; sessionVersion: object };
      };
      expect(call.where).toEqual({ id: user.id, sessionVersion: 2 });
      expect(call.data.sessionVersion).toEqual({ increment: 1 });
      expect(await argon2.verify(call.data.passwordHash, newPassword)).toBe(true);
      expect(jwt.signAsync).toHaveBeenCalledWith({ sub: user.id, ver: 3 });
    });

    it('rejects a wrong current password with 403 and a reused password with 400', async () => {
      prisma.user.findUnique.mockResolvedValue(await stored());
      await expect(service.changePassword(user.id, { currentPassword: 'wrong-password', newPassword }))
        .rejects.toMatchObject({ status: 403 });
      await expect(service.changePassword(user.id, { currentPassword: password, newPassword: password }))
        .rejects.toMatchObject({ status: 400 });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('reports a concurrent session change as a conflict', async () => {
      prisma.user.findUnique.mockResolvedValue(await stored());
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.changePassword(user.id, { currentPassword: password, newPassword }))
        .rejects.toMatchObject({ status: 409 });
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  it('revokes every session by incrementing the session version', async () => {
    prisma.user.update.mockResolvedValue({ id: user.id });
    await service.revokeSessions(user.id);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id }, data: { sessionVersion: { increment: 1 } }, select: { id: true },
    });
  });
});
