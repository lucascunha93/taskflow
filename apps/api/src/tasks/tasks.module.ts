
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TaskCommentsController } from './comments/task-comments.controller.js';
import { TaskCommentsService } from './comments/task-comments.service.js';

@Module({
  imports: [AuthModule, ActivityModule],
  controllers: [TasksController, TaskCommentsController],
  providers: [TasksService, TaskCommentsService],
})
export class TasksModule {}
