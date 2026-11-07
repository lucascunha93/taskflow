import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { NotificationsService } from './notifications.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

export class NotificationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsUUID()
  before?: string;

  /** `true` lista somente as não lidas. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unread?: boolean;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: NotificationQueryDto) {
    return this.notifications.list(request.user.sub, query);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async readAll(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.notifications.markAllRead(request.user.sub);
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(
    @Req() request: AuthenticatedRequest,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<void> {
    await this.notifications.markRead(request.user.sub, notificationId);
  }
}
