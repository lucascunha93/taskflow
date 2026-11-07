import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

interface JwtPayload {
  sub: string;
  /** Versão de sessão do usuário quando o token foi emitido; ausente equivale a 0. */
  ver?: number;
  iat?: number;
  exp?: number;
}

type AuthenticatedRequest = Request & {
  user?: JwtPayload;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      throw new UnauthorizedException(
        'Token de acesso ausente ou inválido.',
      );
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(
        match[1],
      );
    } catch {
      throw new UnauthorizedException(
        'Token de acesso inválido ou expirado.',
      );
    }

    if (
      typeof payload.sub !== 'string' || !payload.sub ||
      (payload.ver !== undefined && (!Number.isInteger(payload.ver) || payload.ver < 0))
    ) {
      throw new UnauthorizedException('Token de acesso inválido.');
    }

    // Tokens de usuários removidos ou emitidos antes de uma troca de senha ou
    // revogação de sessões deixam de ser aceitos imediatamente.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { sessionVersion: true },
    });

    if (!user || user.sessionVersion !== (payload.ver ?? 0)) {
      throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
    }

    request.user = payload;

    return true;
  }
}