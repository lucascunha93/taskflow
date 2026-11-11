import { Controller, Get, INestApplication, Module, NotFoundException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import request from 'supertest';
import { sentryOptions } from '../src/monitoring/sentry-options.js';

const captured: Sentry.ErrorEvent[] = [];

@Controller('probe')
class ProbeController {
  @Get('crash')
  crash(): never {
    throw new Error('Falha inesperada ao processar ana@example.test');
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('Tarefa não encontrada.');
  }
}

@Module({
  imports: [SentryModule.forRoot()],
  controllers: [ProbeController],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
class ProbeModule {}

describe('Error reporting (HTTP with captured events)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const options = sentryOptions({ SENTRY_DSN: 'http://public@127.0.0.1:9/1', NODE_ENV: 'test' })!;
    const scrub = options.beforeSend!;
    Sentry.init({
      ...options,
      // Guarda o evento já limpo em vez de enviá-lo pela rede.
      beforeSend: async (event, hint) => {
        const result = await scrub(event, hint);
        if (result) captured.push(result);
        return null;
      },
    });
    const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close();
  });

  beforeEach(() => {
    captured.length = 0;
  });

  it('reports unexpected errors without credentials, query strings or e-mails', async () => {
    const response = await request(app.getHttpServer()).get('/probe/crash?token=segredo')
      .set('Authorization', 'Bearer abc.def.ghi').set('Cookie', 'taskflow_refresh=segredo').expect(500);
    expect(JSON.stringify(response.body)).not.toContain('ana@example.test');
    await Sentry.flush(2000);
    expect(captured).toHaveLength(1);
    const [event] = captured;
    expect(event.exception?.values?.[0].value).toBe('Falha inesperada ao processar [e-mail removido]');
    const leaked = JSON.stringify(event).match(/.{0,80}(segredo|Bearer abc|taskflow_refresh|ana@example).{0,40}/g);
    expect(leaked).toBeNull();
    expect(event.environment).toBe('test');
  });

  it('does not report expected HTTP errors', async () => {
    await request(app.getHttpServer()).get('/probe/missing').expect(404);
    await Sentry.flush(2000);
    expect(captured).toHaveLength(0);
  });
});
