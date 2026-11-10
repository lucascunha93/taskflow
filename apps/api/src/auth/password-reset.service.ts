import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { MailService, maskEmail } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RefreshTokensService, hashRefreshToken } from './refresh-tokens.service.js';

export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
/** Intervalo mínimo entre e-mails de redefinição para o mesmo usuário. */
export const PASSWORD_RESET_COOLDOWN_MS = 60_000;

/**
 * Recuperação de senha por e-mail.
 *
 * - O pedido sempre recebe a mesma resposta, exista ou não a conta, para não
 *   revelar quais e-mails estão cadastrados; o processamento acontece em
 *   segundo plano para que o tempo de resposta também não revele.
 * - O link vale 30 minutos e uma única vez; pedir de novo invalida o anterior.
 *   Um novo e-mail para o mesmo usuário só sai após 1 minuto.
 * - Só o hash SHA-256 do token é guardado.
 * - Redefinir encerra todas as sessões (versão de sessão e refresh tokens) e
 *   remove um bloqueio de login por tentativas.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly refreshTokens: RefreshTokensService,
    config: ConfigService,
  ) {
    this.appUrl = (config.get<string>('APP_URL') ?? 'http://localhost:4200').replace(/\/+$/, '');
  }

  /** Lança 503 se não houver envio de e-mail; o restante roda em `request`. */
  assertAvailable(): void {
    if (!this.mail.enabled) {
      throw new ServiceUnavailableException('A recuperação de senha não está disponível.');
    }
  }

  /** Cria o link e envia o e-mail, se a conta existir. Nunca revela o resultado a quem pediu. */
  async request(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    const created = await this.prisma.$transaction(async (tx) => {
      // Serializa pedidos simultâneos do mesmo usuário.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR NO KEY UPDATE`;
      const recent = await tx.passwordResetToken.findFirst({
        where: { userId: user.id, createdAt: { gt: new Date(Date.now() - PASSWORD_RESET_COOLDOWN_MS) } },
        select: { id: true },
      });
      if (recent) return false;
      // Só o link mais recente vale.
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashRefreshToken(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
      });
      return true;
    });
    if (!created) return;

    // O token vai no fragmento (#): navegadores não o enviam ao servidor nem como Referer.
    const link = `${this.appUrl}/reset-password#token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Redefinição de senha do TaskFlow',
      text: [
        `Olá, ${user.name}.`,
        '',
        'Recebemos um pedido para redefinir a senha da sua conta no TaskFlow.',
        'Para criar uma nova senha, abra o link abaixo em até 30 minutos:',
        '',
        link,
        '',
        'O link funciona uma única vez. Ao redefinir, todas as sessões abertas serão encerradas.',
        'Se você não fez esse pedido, ignore este e-mail; sua senha continua a mesma.',
      ].join('\n'),
    });
  }

  /** Dispara `request` sem esperar, registrando falhas sem expor dados. */
  requestInBackground(email: string): void {
    this.request(email).catch((error: unknown) => {
      this.logger.error(`Falha ao processar redefinição de senha para ${maskEmail(email.trim())}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async reset(token: string, newPassword: string): Promise<void> {
    const invalid = () => new BadRequestException('Link inválido ou expirado. Peça uma nova redefinição de senha.');
    const tokenHash = hashRefreshToken(token);
    const pending = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { usedAt: true, expiresAt: true },
    });
    if (!pending || pending.usedAt || pending.expiresAt <= new Date()) throw invalid();

    // O hash é calculado fora da transação, que fica curta.
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      // Uso único, mesmo com envios simultâneos do mesmo link.
      const consumed = await tx.passwordResetToken.updateManyAndReturn({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
        select: { userId: true },
      });
      if (consumed.length === 0) throw invalid();
      const userId = consumed[0].userId;
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, sessionVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null },
        select: { id: true },
      });
      await this.refreshTokens.revokeAllForUser(userId, tx);
      await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    });
  }
}
