import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MailService, maskEmail } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { RefreshTokensService, hashRefreshToken } from './refresh-tokens.service.js';

describe('PasswordResetService', () => {
  const user = { id: 'u1', name: 'Ana', email: 'ana@example.test' };
  let mail: { enabled: boolean; send: ReturnType<typeof vi.fn> };
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    passwordResetToken: {
      findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>; updateManyAndReturn: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };
  let refreshTokens: { revokeAllForUser: ReturnType<typeof vi.fn> };
  let service: PasswordResetService;

  beforeEach(async () => {
    mail = { enabled: true, send: vi.fn().mockResolvedValue(undefined) };
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue({ id: 'u1' }) },
      passwordResetToken: {
        findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(), create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }), updateManyAndReturn: vi.fn().mockResolvedValue([{ userId: 'u1' }]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    refreshTokens = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: RefreshTokensService, useValue: refreshTokens },
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'APP_URL' ? 'https://app.example.test/' : undefined) } },
      ],
    }).compile();
    service = module.get(PasswordResetService);
  });

  it('sends a single-use link in the URL fragment and stores only its hash', async () => {
    await service.request(' ANA@example.test ');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'ana@example.test' } }));
    const message = mail.send.mock.calls[0][0] as { to: string; text: string };
    const token = /https:\/\/app\.example\.test\/reset-password#token=([\w-]+)/.exec(message.text)?.[1];
    expect(message.to).toBe('ana@example.test');
    expect(token).toHaveLength(43);
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: { userId: 'u1', tokenHash: hashRefreshToken(token!), expiresAt: expect.any(Date) },
    });
    // Pedir de novo invalida o link anterior.
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', usedAt: null } });
  });

  it('does nothing for unknown e-mails and respects the cooldown', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await service.request('nobody@example.test');
    prisma.passwordResetToken.findFirst.mockResolvedValueOnce({ id: 'recent' });
    await service.request('ana@example.test');
    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('is unavailable without an e-mail provider', () => {
    mail.enabled = false;
    expect(() => service.assertAvailable()).toThrow(expect.objectContaining({ status: 503 }));
  });

  it('resets the password, unlocks the account and ends every session', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({ usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    await service.reset('a-valid-reset-token-0123456789', 'uma-senha-nova-forte');
    const update = prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ sessionVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null });
    expect(String(update.data.passwordHash)).toMatch(/^\$argon2id\$/);
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('u1', prisma);
  });

  it('rejects unknown, used, expired and concurrently consumed tokens', async () => {
    const attempt = () => service.reset('a-valid-reset-token-0123456789', 'uma-senha-nova-forte');
    prisma.passwordResetToken.findUnique.mockResolvedValueOnce(null);
    await expect(attempt()).rejects.toMatchObject({ status: 400 });
    prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    await expect(attempt()).rejects.toMatchObject({ status: 400 });
    prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ usedAt: null, expiresAt: new Date(Date.now() - 1) });
    await expect(attempt()).rejects.toMatchObject({ status: 400 });
    prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ usedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    prisma.passwordResetToken.updateManyAndReturn.mockResolvedValueOnce([]);
    await expect(attempt()).rejects.toMatchObject({ status: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('masks e-mails in logs', () => {
    expect(maskEmail('ana.silva@example.test')).toBe('a***@example.test');
  });
});
