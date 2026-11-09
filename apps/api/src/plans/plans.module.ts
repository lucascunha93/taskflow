import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

/** Global: organizações, projetos, tarefas e anexos aplicam os limites do plano. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
