import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { BILLING_PROVIDER, FakeBillingProvider } from './billing-provider.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      // A validação do ambiente garante que "fake" nunca chega à produção.
      provide: BILLING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => (config.get<string>('BILLING_PROVIDER') === 'fake' ? new FakeBillingProvider() : null),
    },
  ],
})
export class BillingModule {}
