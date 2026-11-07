import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const notificationSelect = {
  id: true,
  type: true,
  organizationId: true,
  taskId: true,
  taskTitle: true,
  readAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true } },
  actor: { select: { id: true, name: true } },
} satisfies Prisma.NotificationSelect;

export interface NotificationEvent {
  organizationId: string;
  taskId: string;
  taskTitle: string;
  actorId: string;
  type: NotificationType;
  /** Destinatários candidatos; o autor da ação e repetições são descartados. */
  recipients: (string | null | undefined)[];
}

export interface NotificationQuery {
  limit?: number;
  before?: string;
  unread?: boolean;
}

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Deve ser chamado dentro da mesma transação da operação que gera o evento. */
  async notify(client: Client, event: NotificationEvent): Promise<void> {
    const recipients = [...new Set(event.recipients.filter((id): id is string => !!id && id !== event.actorId))];
    if (recipients.length === 0) return;
    await client.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        organizationId: event.organizationId,
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        actorId: event.actorId,
        type: event.type,
      })),
    });
  }

  async list(userId: string, query: NotificationQuery) {
    const limit = query.limit ?? 20;
    const visible = this.visibleTo(userId);
    const where: Prisma.NotificationWhereInput = query.unread ? { ...visible, readAt: null } : visible;
    if (query.before) {
      const cursor = await this.prisma.notification.findFirst({ where: { ...where, id: query.before }, select: { id: true } });
      if (!cursor) {
        throw new BadRequestException('O cursor informado não pertence a estas notificações.');
      }
    }
    const [rows, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
        select: notificationSelect,
      }),
      this.prisma.notification.count({ where: { ...visible, readAt: null } }),
    ]);
    const data = rows.slice(0, limit);
    return { data, nextCursor: rows.length > limit ? data[data.length - 1].id : null, unreadCount };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const visible = this.visibleTo(userId);
    const result = await this.prisma.notification.updateMany({
      where: { ...visible, id: notificationId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) return;
    const existing = await this.prisma.notification.findFirst({ where: { ...visible, id: notificationId }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException('Notificação não encontrada.');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { ...this.visibleTo(userId), readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Somente notificações do usuário em organizações das quais ainda participa. */
  private visibleTo(userId: string): Prisma.NotificationWhereInput {
    return { userId, organization: { memberships: { some: { userId } } } };
  }
}
