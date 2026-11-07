import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Janela em que um token recém-trocado ainda é tratado como refresh
 * concorrente (por exemplo, duas abas que compartilham o cookie), e não como
 * reutilização indevida.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;
export const DEFAULT_REFRESH_TTL_DAYS = 7;

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedSession {
  user: { id: string; name: string; email: string };
  sessionVersion: number;
  refreshToken: IssuedRefreshToken;
}

type Client = PrismaService | Prisma.TransactionClient;

export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class RefreshTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  ttlMs(): number {
    const days = Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? DEFAULT_REFRESH_TTL_DAYS);
    return days * 24 * 60 * 60 * 1000;
  }

  /** Emite um token; sem `familyId`, inicia uma nova sessão. */
  async issue(
    userId: string,
    sessionVersion: number,
    familyId?: string,
    client: Client = this.prisma,
  ): Promise<IssuedRefreshToken & { id: string }> {
    const now = Date.now();
    if (!familyId) {
      // Uma nova sessão é um bom momento para descartar tokens expirados do usuário.
      await client.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date(now) } } });
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now + this.ttlMs());
    const created = await client.refreshToken.create({
      data: {
        userId,
        familyId: familyId ?? randomUUID(),
        tokenHash: hashRefreshToken(token),
        sessionVersion,
        expiresAt,
      },
      select: { id: true },
    });
    return { id: created.id, token, expiresAt };
  }

  /**
   * Troca um refresh token válido por um novo da mesma família. Um token já
   * trocado fora da janela de concorrência revoga toda a família.
   */
  async rotate(token: string): Promise<RotatedSession> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      select: {
        id: true,
        familyId: true,
        sessionVersion: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
        user: { select: { id: true, name: true, email: true, sessionVersion: true } },
      },
    });

    if (!stored) {
      throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    }

    const now = new Date();
    if (stored.revokedAt) {
      if (stored.replacedById && now.getTime() - stored.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
        throw new ConflictException('A sessão está sendo renovada por outra requisição. Tente novamente.');
      }
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    }

    if (stored.expiresAt <= now || stored.sessionVersion !== stored.user.sessionVersion) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    const { user } = stored;
    const refreshToken = await this.prisma.$transaction(async (tx) => {
      const next = await this.issue(user.id, stored.sessionVersion, stored.familyId, tx);
      const updated = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now, replacedById: next.id },
      });
      if (updated.count !== 1) {
        // Outra requisição trocou o mesmo token; a transação desfaz o novo token.
        throw new ConflictException('A sessão está sendo renovada por outra requisição. Tente novamente.');
      }
      return { token: next.token, expiresAt: next.expiresAt };
    });

    return {
      user: { id: user.id, name: user.name, email: user.email },
      sessionVersion: stored.sessionVersion,
      refreshToken,
    };
  }

  /** Encerra a sessão a que o token pertence. Tokens desconhecidos são ignorados. */
  async revokeFamilyOf(token: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      select: { familyId: true },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  async revokeAllForUser(userId: string, client: Client = this.prisma): Promise<void> {
    await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
