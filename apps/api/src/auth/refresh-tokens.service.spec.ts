import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashRefreshToken, REFRESH_REUSE_GRACE_MS, RefreshTokensService } from './refresh-tokens.service.js';
import { readRefreshCookie, REFRESH_COOKIE } from './refresh-cookie.js';
import type { Request } from 'express';

describe('RefreshTokensService', () => {
  const user = { id: 'user', name: 'User', email: 'user@example.test', sessionVersion: 2 };
  let service: RefreshTokensService;
  let prisma: {
    refreshToken: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  const stored = (overrides: object = {}) => ({
    id: 'stored', familyId: 'family', sessionVersion: 2, revokedAt: null, replacedById: null,
    expiresAt: new Date(Date.now() + 60_000), user, ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: vi.fn().mockResolvedValue({ id: 'next' }),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    const module = await Test.createTestingModule({
      providers: [
        RefreshTokensService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'REFRESH_TOKEN_TTL_DAYS' ? '2' : undefined) } },
      ],
    }).compile();
    service = module.get(RefreshTokensService);
  });

  it('issues a random token, stores only its hash and uses the configured lifetime', async () => {
    const before = Date.now();
    const issued = await service.issue(user.id, 2);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const data = prisma.refreshToken.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data.tokenHash).toBe(hashRefreshToken(issued.token));
    expect(JSON.stringify(data)).not.toContain(issued.token);
    expect(data).toMatchObject({ userId: user.id, sessionVersion: 2, familyId: expect.any(String) });
    expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 86_400_000);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: user.id, expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('rotates a valid token within the same family', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored());
    const rotated = await service.rotate('token');
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tokenHash: hashRefreshToken('token') },
    }));
    expect(prisma.refreshToken.create.mock.calls[0]?.[0].data).toMatchObject({ familyId: 'family', sessionVersion: 2 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'stored', revokedAt: null },
      data: { revokedAt: expect.any(Date), replacedById: 'next' },
    });
    expect(rotated).toMatchObject({
      user: { id: user.id, name: user.name, email: user.email }, sessionVersion: 2,
      refreshToken: { token: expect.any(String) },
    });
  });

  it('rejects unknown, expired and session-revoked tokens', async () => {
    prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.rotate('x')).rejects.toMatchObject({ status: 401 });
    prisma.refreshToken.findUnique.mockResolvedValueOnce(stored({ expiresAt: new Date(Date.now() - 1) }));
    await expect(service.rotate('x')).rejects.toMatchObject({ status: 401 });
    prisma.refreshToken.findUnique.mockResolvedValueOnce(stored({ sessionVersion: 1 }));
    await expect(service.rotate('x')).rejects.toMatchObject({ status: 401 });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('answers 409 for a concurrent refresh inside the grace window without revoking the family', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({ revokedAt: new Date(), replacedById: 'next' }));
    await expect(service.rotate('x')).rejects.toMatchObject({ status: 409 });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('revokes the whole family when a replaced token is reused after the grace window', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({
      revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1), replacedById: 'next',
    }));
    await expect(service.rotate('x')).rejects.toMatchObject({ status: 401 });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });

  it('reports a lost race on the conditional rotation as a conflict', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored());
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.rotate('x')).rejects.toMatchObject({ status: 409 });
  });
});

describe('readRefreshCookie', () => {
  const read = (cookie?: string) => readRefreshCookie({ headers: { cookie } } as Request);

  it('reads only the refresh cookie', () => {
    expect(read(undefined)).toBeUndefined();
    expect(read('a=1; other=2')).toBeUndefined();
    expect(read(`a=1; ${REFRESH_COOKIE}=abc_-1`)).toBe('abc_-1');
    expect(read(`${REFRESH_COOKIE}=`)).toBeUndefined();
    expect(read(`${REFRESH_COOKIE}=%E0%A4%A`)).toBeUndefined();
  });
});
