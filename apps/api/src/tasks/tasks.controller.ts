
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { TasksService } from './tasks.service.js';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
  };
}

@Controller('organizations/:organizationId/tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
  ) {}

  @Get()
  findAll(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tasksService.findAll(organizationId, request.user.sub);
  }

  @Get(':taskId')
  findOne(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tasksService.findOne(organizationId, taskId, request.user.sub);
  }

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(
      organizationId,
      request.user.sub,
      dto,
    );
  }

  @Put(':taskId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(organizationId, taskId, request.user.sub, dto);
  }
}
