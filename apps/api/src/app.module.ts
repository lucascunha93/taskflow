import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from '@nestjs/config';
import { observeOptions, validateEnvironment } from './config/environment.js';
export const { ObserveModule, ObserveInstrument } = createObserveModule();
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    AuthModule,
    // Avaliado depois do ConfigModule carregar o .env. Sem o par de credenciais,
    // o Observe fica desabilitado: não grava nem envia telemetria.
    ObserveModule.forRoot(observeOptions(process.env)),
    OrganizationsModule,
    TasksModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule { }
