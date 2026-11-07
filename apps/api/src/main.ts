import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule, ObserveInstrument } from './app.module.js';
import { parseCorsOrigins } from './config/environment.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  const config = app.get(ConfigService);

  // Cabeçalhos de segurança padrão; a API responde somente JSON.
  app.use(helmet());

  // Necessário para que o rate limiting identifique o IP real atrás de um proxy reverso.
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) app.set('trust proxy', Number(trustProxy));

  // CORS é opt-in: sem CORS_ORIGINS, somente a mesma origem (ou o proxy do frontend) acessa a API.
  const origins = parseCorsOrigins(config.get<string>('CORS_ORIGINS'));
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(config.get<string>('PORT') ?? 3000);
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    'Falha ao iniciar a aplicação.',
    error instanceof Error ? error.stack : String(error),
    'Bootstrap',
  );
  process.exitCode = 1;
});
