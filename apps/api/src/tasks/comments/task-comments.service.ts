import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MembershipRole, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CommentBodyDto, ListCommentsQueryDto } from './dto/comment.dto.js';

export const commentSelect = {
  id: true,
  taskId: true,
  body: true,
  editedAt: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.TaskCommentSelect;

type CommentDetails = Prisma.TaskCommentGetPayload<{ select: typeof commentSelect }>;

/**
 * Comentários de tarefas. Qualquer membro da organização lê e comenta; somente
 * o autor edita; o autor, OWNER ou ADMIN podem excluir.
 */
@Injectable()
export class TaskCommentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, taskId: string, userId: string, query: ListCommentsQueryDto) {
    await this.assertTaskAccess(organizationId, taskId, userId);
    const limit = query.limit ?? 50;

    if (query.after) {
      const cursor = await this.prisma.taskComment.findFirst({
        where: { id: query.after, taskId, organizationId },
        select: { id: true },
      });
      if (!cursor) {
        throw new BadRequestException('O cursor informado não pertence a esta tarefa.');
      }
    }

    const rows = await this.prisma.taskComment.findMany({
      where: { taskId, organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
      select: commentSelect,
    });

    const data = rows.slice(0, limit);
    return { data, nextCursor: rows.length > limit ? data[data.length - 1].id : null };
  }

  async create(
    organizationId: string,
    taskId: string,
    userId: string,
    dto: CommentBodyDto,
  ): Promise<CommentDetails> {
    await this.assertTaskAccess(organizationId, taskId, userId);
    return this.prisma.taskComment.create({
      data: { organizationId, taskId, authorId: userId, body: dto.body.trim() },
      select: commentSelect,
    });
  }

  async update(
    organizationId: string,
    taskId: string,
    commentId: string,
    userId: string,
    dto: CommentBodyDto,
  ): Promise<CommentDetails> {
    await this.assertTaskAccess(organizationId, taskId, userId);
    const updated = await this.prisma.taskComment.updateManyAndReturn({
      where: { id: commentId, taskId, organizationId, authorId: userId },
      data: { body: dto.body.trim(), editedAt: new Date() },
      select: commentSelect,
    });
    if (updated.length > 0) return updated[0];

    await this.findComment(organizationId, taskId, commentId);
    throw new ForbiddenException('Somente o autor pode editar o comentário.');
  }

  async remove(organizationId: string, taskId: string, commentId: string, userId: string): Promise<void> {
    const role = await this.assertTaskAccess(organizationId, taskId, userId);
    const canModerate = role === 'OWNER' || role === 'ADMIN';
    const result = await this.prisma.taskComment.deleteMany({
      where: {
        id: commentId,
        taskId,
        organizationId,
        ...(canModerate ? {} : { authorId: userId }),
      },
    });
    if (result.count > 0) return;

    await this.findComment(organizationId, taskId, commentId);
    throw new ForbiddenException('Somente o autor, proprietários e administradores podem excluir o comentário.');
  }

  /** Valida a associação (404 para organização inacessível) e a tarefa na organização. */
  private async assertTaskAccess(organizationId: string, taskId: string, userId: string): Promise<MembershipRole> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!membership) {
      throw new NotFoundException('Organização não encontrada.');
    }
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    return membership.role;
  }

  private async findComment(organizationId: string, taskId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.taskComment.findFirst({
      where: { id: commentId, taskId, organizationId },
      select: { id: true },
    });
    if (!comment) {
      throw new NotFoundException('Comentário não encontrado.');
    }
  }
}
