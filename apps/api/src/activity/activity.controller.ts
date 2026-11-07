import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ActivityService } from './activity.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

export class ActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Continua a listagem com atividades anteriores a esta (ordem decrescente). */
  @IsOptional()
  @IsUUID()
  before?: string;
}

@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('activity')
  organization(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: ActivityQueryDto,
  ) {
    return this.activity.listForOrganization(organizationId, request.user.sub, query);
  }

  @Get('tasks/:taskId/activity')
  task(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: ActivityQueryDto,
  ) {
    return this.activity.listForTask(organizationId, taskId, request.user.sub, query);
  }
}
