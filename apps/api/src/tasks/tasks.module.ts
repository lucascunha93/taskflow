
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TaskCommentsController } from './comments/task-comments.controller.js';
import { TaskCommentsService } from './comments/task-comments.service.js';
import { TaskAttachmentsController } from './attachments/task-attachments.controller.js';
import { TaskAttachmentsService } from './attachments/task-attachments.service.js';

@Module({
  imports: [AuthModule, ActivityModule, NotificationsModule],
  controllers: [TasksController, TaskCommentsController, TaskAttachmentsController],
  providers: [TasksService, TaskCommentsService, TaskAttachmentsService],
})
export class TasksModule {}
