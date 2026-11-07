
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

/** Falhas consecutivas que bloqueiam temporariamente o login da conta. */
export const MAX_FAILED_LOGINS = 5;
/** Duração do bloqueio após atingir {@link MAX_FAILED_LOGINS}. */
export const LOGIN_LOCK_MS = 15 * 60_000;

const ACCESS_TOKEN_TTL_SECONDS = 900;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException(
        'Este e-mail já está cadastrado.',
      );
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Este e-mail já está cadastrado.',
        );
      }

      throw error;
    }
  }


  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        sessionVersion: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      // Verifica um hash descartável para que e-mails inexistentes levem um
      // tempo semelhante ao de senhas incorretas.
      await argon2.verify(await this.dummyHash(), dto.password).catch(() => false);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        'Muitas tentativas de login. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordIsValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );

    if (!passwordIsValid) {
      await this.registerFailedLogin(user.id);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return this.tokenResponse(user, user.sessionVersion);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Usuário não encontrado.',
      );
    }

    return user;
  }

  /**
   * Troca a senha após confirmar a atual. A versão de sessão é incrementada,
   * invalidando todos os tokens anteriores; a resposta traz um novo token
   * para a sessão que fez a alteração.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, passwordHash: true, sessionVersion: true },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    // 403 (e não 401) para não ser confundido com sessão expirada pelo cliente.
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new ForbiddenException('A senha atual está incorreta.');
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual.');
    }

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });

    // Condicionado à versão lida: uma troca ou revogação concorrente gera conflito.
    const updated = await this.prisma.user.updateMany({
      where: { id: user.id, sessionVersion: user.sessionVersion },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    if (updated.count !== 1) {
      throw new ConflictException('A sessão foi alterada por outra operação. Entre novamente.');
    }

    return this.tokenResponse(user, user.sessionVersion + 1);
  }

  /** Invalida todos os tokens emitidos para o usuário, inclusive o atual. */
  async revokeSessions(userId: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new UnauthorizedException('Usuário não encontrado.');
      }
      throw error;
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name.trim() },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new UnauthorizedException('Usuário não encontrado.');
      }
      throw error;
    }
  }

  private async tokenResponse(
    user: { id: string; name: string; email: string },
    sessionVersion: number,
  ) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      ver: sessionVersion,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  }

  private async registerFailedLogin(userId: string): Promise<void> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (failedLoginAttempts >= MAX_FAILED_LOGINS) {
      await this.prisma.user.updateMany({
        where: { id: userId, failedLoginAttempts: { gte: MAX_FAILED_LOGINS } },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS),
        },
      });
    }
  }

  private dummyHashPromise: Promise<string> | null = null;

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2.hash(randomUUID(), { type: argon2.argon2id });
    return this.dummyHashPromise;
  }
}
