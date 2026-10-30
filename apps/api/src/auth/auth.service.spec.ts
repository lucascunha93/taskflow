import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } };
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  const password = 'valid-test-password';
  const user = { id: 'user', name: 'User', email: 'user@example.test' };

  beforeEach(async () => {
    prisma = { user: { findUnique: vi.fn(), create: vi.fn() } };
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

  it('rejects missing users and wrong passwords', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...user, passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    });
    await expect(service.login({ email: user.email, password })).rejects.toMatchObject({ status: 401 });
    await expect(service.login({ email: user.email, password: 'wrong-password' })).rejects.toMatchObject({ status: 401 });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('signs the authenticated user ID and excludes the password hash', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user, passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    });
    await expect(service.login({ email: ' USER@example.test ', password })).resolves.toEqual({
      accessToken: 'signed-test-token', tokenType: 'Bearer', expiresIn: 900, user,
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: user.id });
  });

  it('rejects profile lookup when the user no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile(user.id)).rejects.toMatchObject({ status: 401 });
  });
});
