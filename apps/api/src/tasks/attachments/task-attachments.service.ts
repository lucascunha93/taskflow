import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MembershipRole, Prisma } from '../../generated/prisma/client.js';
import { ActivityService } from '../../activity/activity.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ObjectStorageService } from '../../storage/object-storage.service.js';
import { ATTACHMENTS_PER_TASK, attachmentContentType, sanitizeFileName } from './file-policy.js';

export const attachmentSelect = {
  id: true,
  taskId: true,
  fileName: true,
  contentType: true,
  size: true,
  createdAt: true,
  uploader: { select: { id: true, name: true } },
} satisfies Prisma.TaskAttachmentSelect;

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Anexos de tarefas. Membros listam, enviam e baixam; o autor do envio, OWNER
 * e ADMIN excluem. O conteúdo fica no armazenamento de objetos e só é obtido
 * por URL assinada de curta duração.
 */
@Injectable()
export class TaskAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly activity: ActivityService,
  ) {}

  async list(organizationId: string, taskId: string, userId: string) {
    await this.assertTaskAccess(organizationId, taskId, userId);
    return this.prisma.taskAttachment.findMany({
      where: { taskId, organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: attachmentSelect,
    });
  }

  async upload(organizationId: string, taskId: string, userId: string, file: UploadedFile | undefined) {
    if (!file) {
      throw new BadRequestException('Envie um arquivo no campo "file".');
    }
    const { title } = await this.assertTaskAccess(organizationId, taskId, userId);
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('O armazenamento de anexos não está configurado.');
    }
    const fileName = sanitizeFileName(file.originalname);
    if (!fileName) {
      throw new BadRequestException('O arquivo precisa ter um nome.');
    }
    const contentType = attachmentContentType(fileName, file.buffer);
    const count = await this.prisma.taskAttachment.count({ where: { taskId, organizationId } });
    if (count >= ATTACHMENTS_PER_TASK) {
      throw new ConflictException(`Uma tarefa pode ter no máximo ${ATTACHMENTS_PER_TASK} anexos.`);
    }

    const id = randomUUID();
    const storageKey = `organizations/${organizationId}/tasks/${taskId}/${id}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attachment = await tx.taskAttachment.create({
          data: { id, organizationId, taskId, uploaderId: userId, fileName, contentType, size: file.buffer.length, storageKey },
          select: attachmentSelect,
        });
        await this.activity.record(tx, {
          organizationId, taskId, taskTitle: title, actorId: userId, type: 'ATTACHMENT_ADDED',
          changes: [{ field: 'attachment', from: null, to: fileName }],
        });
        return attachment;
      });
    } catch (error: unknown) {
      // O registro não foi gravado: o objeto enviado não pode ficar órfão.
      await this.storage.deleteQuietly([storageKey]);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundException('Tarefa não encontrada.');
      }
      throw error;
    }
  }

  async downloadUrl(organizationId: string, taskId: string, attachmentId: string, userId: string) {
    await this.assertTaskAccess(organizationId, taskId, userId);
    const attachment = await this.find(organizationId, taskId, attachmentId);
    return this.storage.downloadUrl(attachment.storageKey, attachment.fileName, attachment.contentType);
  }

  async remove(organizationId: string, taskId: string, attachmentId: string, userId: string): Promise<void> {
    const { role, title } = await this.assertTaskAccess(organizationId, taskId, userId);
    const attachment = await this.find(organizationId, taskId, attachmentId);
    if (attachment.uploaderId !== userId && role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Somente quem enviou, proprietários e administradores podem excluir o anexo.');
    }
    const removed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.taskAttachment.deleteMany({ where: { id: attachmentId, taskId, organizationId } });
      if (result.count === 0) return false;
      await this.activity.record(tx, {
        organizationId, taskId, taskTitle: title, actorId: userId, type: 'ATTACHMENT_REMOVED',
        changes: [{ field: 'attachment', from: attachment.fileName, to: null }],
      });
      return true;
    });
    if (!removed) {
      throw new NotFoundException('Anexo não encontrado.');
    }
    await this.storage.deleteQuietly([attachment.storageKey]);
  }

  private async find(organizationId: string, taskId: string, attachmentId: string) {
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId, organizationId },
      select: { id: true, fileName: true, contentType: true, storageKey: true, uploaderId: true },
    });
    if (!attachment) {
      throw new NotFoundException('Anexo não encontrado.');
    }
    return attachment;
  }

  private async assertTaskAccess(
    organizationId: string,
    taskId: string,
    userId: string,
  ): Promise<{ role: MembershipRole; title: string }> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!membership) {
      throw new NotFoundException('Organização não encontrada.');
    }
    const task = await this.prisma.task.findFirst({ where: { id: taskId, organizationId }, select: { title: true } });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    return { role: membership.role, title: task.title };
  }
}
