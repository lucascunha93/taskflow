import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ATTACHMENT_MAX_BYTES } from './file-policy.js';
import { TaskAttachmentsService, type UploadedFile as AttachmentFile } from './task-attachments.service.js';

interface AuthenticatedRequest extends Request {
  user: { sub: string };
}

@Controller('organizations/:organizationId/tasks/:taskId/attachments')
@UseGuards(JwtAuthGuard)
export class TaskAttachmentsController {
  constructor(private readonly attachments: TaskAttachmentsService) {}

  @Get()
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attachments.list(organizationId, taskId, request.user.sub);
  }

  /** multipart/form-data com o campo `file`; arquivos acima do limite recebem 413. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0, parts: 2 } }))
  upload(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: AttachmentFile | undefined,
  ) {
    return this.attachments.upload(organizationId, taskId, request.user.sub, file);
  }

  /** Retorna `{ url, expiresAt }`: URL assinada de curta duração para baixar o arquivo. */
  @Get(':attachmentId/download')
  download(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attachments.downloadUrl(organizationId, taskId, attachmentId, request.user.sub);
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.attachments.remove(organizationId, taskId, attachmentId, request.user.sub);
  }
}
