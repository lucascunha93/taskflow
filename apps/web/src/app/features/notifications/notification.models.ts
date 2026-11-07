export type NotificationType = 'TASK_ASSIGNED' | 'TASK_COMMENTED';

export interface AppNotification {
  id: string;
  type: NotificationType;
  organizationId: string;
  organization: { id: string; name: string };
  taskId: string | null;
  taskTitle: string;
  readAt: string | null;
  createdAt: string;
  actor: { id: string; name: string };
}

export interface NotificationPage {
  data: AppNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

const text = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const ref = (value: unknown): value is { id: string; name: string } =>
  typeof value === 'object' && value !== null && 'id' in value && text(value.id) && 'name' in value && text(value.name);

export function notificationPageFromResponse(value: unknown): NotificationPage {
  if (typeof value !== 'object' || value === null || !('data' in value) || !Array.isArray(value.data) ||
    !('nextCursor' in value) || !nullableText(value.nextCursor) ||
    !('unreadCount' in value) || !Number.isInteger(value.unreadCount) || (value.unreadCount as number) < 0) {
    throw new Error('Resposta de notificações inválida.');
  }
  const data = value.data.map((item: unknown): AppNotification => {
    if (typeof item !== 'object' || item === null ||
      !('id' in item) || !text(item.id) ||
      !('type' in item) || (item.type !== 'TASK_ASSIGNED' && item.type !== 'TASK_COMMENTED') ||
      !('organizationId' in item) || !text(item.organizationId) ||
      !('organization' in item) || !ref(item.organization) || item.organization.id !== item.organizationId ||
      !('taskId' in item) || !nullableText(item.taskId) || !('taskTitle' in item) || !text(item.taskTitle) ||
      !('readAt' in item) || !nullableText(item.readAt) ||
      !('createdAt' in item) || !text(item.createdAt) || Number.isNaN(Date.parse(item.createdAt)) ||
      !('actor' in item) || !ref(item.actor)) {
      throw new Error('Notificação inválida.');
    }
    return {
      id: item.id, type: item.type, organizationId: item.organizationId,
      organization: { id: item.organization.id, name: item.organization.name },
      taskId: item.taskId, taskTitle: item.taskTitle, readAt: item.readAt, createdAt: item.createdAt,
      actor: { id: item.actor.id, name: item.actor.name },
    };
  });
  return { data, nextCursor: value.nextCursor, unreadCount: value.unreadCount as number };
}

export function describeNotification(notification: AppNotification): string {
  return notification.type === 'TASK_ASSIGNED'
    ? `${notification.actor.name} atribuiu a você “${notification.taskTitle}”`
    : `${notification.actor.name} comentou em “${notification.taskTitle}”`;
}
