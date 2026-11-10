import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envio de e-mails. Para um serviço real (SMTP, Amazon SES, Resend...), crie
 * outra implementação desta classe e registre-a conforme MAIL_PROVIDER.
 */
export abstract class MailService {
  abstract readonly enabled: boolean;
  abstract send(message: MailMessage): Promise<void>;
}

/** Oculta o endereço nos logs: "a***@example.com". */
export const maskEmail = (email: string): string => email.replace(/^(.).*(@.*)$/, '$1***$2');

/**
 * Caixa de saída em arquivos, para desenvolvimento (MAIL_PROVIDER=file): cada
 * mensagem vira um arquivo .eml em MAIL_OUTBOX_DIR, que pode ser aberto num
 * cliente de e-mail ou editor. Nada é enviado pela rede. Recusado em produção.
 */
@Injectable()
export class FileMailService extends MailService {
  readonly enabled = true;
  private readonly logger = new Logger(FileMailService.name);
  private readonly directory: string;

  constructor(config: ConfigService) {
    super();
    this.directory = resolve(config.get<string>('MAIL_OUTBOX_DIR') ?? 'tmp/mail');
  }

  async send(message: MailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = resolve(this.directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.eml`);
    const subject = `=?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`;
    const content = [
      'From: TaskFlow <no-reply@taskflow.local>',
      `To: ${message.to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text,
      '',
    ].join('\r\n');
    await writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
    // O conteúdo (que pode ter links com token) não vai para o log.
    this.logger.log(`E-mail para ${maskEmail(message.to)} gravado em ${file}`);
  }
}

/** Sem provedor configurado: os fluxos que dependem de e-mail ficam indisponíveis. */
export class DisabledMailService extends MailService {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error('Envio de e-mail não configurado.');
  }
}
