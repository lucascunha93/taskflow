import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CommentBodyDto, ListCommentsQueryDto } from './dto/comment.dto.js';
import { TaskCommentsService } from './task-comments.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

@Controller('organizations/:organizationId/tasks/:taskId/comments')
@UseGuards(JwtAuthGuard)
export class TaskCommentsController {
  constructor(private readonly comments: TaskCommentsService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: ListCommentsQueryDto,
  ) {
    return this.comments.list(organizationId, taskId, request.user.sub, query);
  }

  @Post()
  create(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CommentBodyDto,
  ) {
    return this.comments.create(organizationId, taskId, request.user.sub, dto);
  }

  @Patch(':commentId')
  update(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CommentBodyDto,
  ) {
    return this.comments.update(organizationId, taskId, commentId, request.user.sub, dto);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.comments.remove(organizationId, taskId, commentId, request.user.sub);
  }
}
