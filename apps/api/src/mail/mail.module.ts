import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DisabledMailService, FileMailService, MailService } from './mail.service.js';

@Global()
@Module({
  providers: [
    {
      // A validação do ambiente garante que "file" nunca chega à produção.
      provide: MailService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('MAIL_PROVIDER') === 'file' ? new FileMailService(config) : new DisabledMailService(),
    },
  ],
  exports: [MailService],
})
export class MailModule {}
