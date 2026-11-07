import { TaskStatus, statusLabel } from '../tasks/task.models';

export type ActivityType = 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_DELETED' | 'COMMENT_ADDED';
export type ChangedField = 'title' | 'description' | 'status' | 'assignee' | 'dueDate';

export interface ActivityChange {
  field: ChangedField;
  from: string | null;
  to: string | null;
}

export interface Activity {
  id: string;
  type: ActivityType;
  taskId: string | null;
  taskTitle: string;
  changes: ActivityChange[] | null;
  createdAt: string;
  actor: { id: string; name: string };
}

export interface ActivityPage {
  data: Activity[];
  nextCursor: string | null;
}

const TYPES: readonly ActivityType[] = ['TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'COMMENT_ADDED'];
const FIELDS: readonly ChangedField[] = ['title', 'description', 'status', 'assignee', 'dueDate'];

const isText = (value: unknown): value is string => typeof value === 'string';
const isNullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';

function changeFromResponse(value: unknown): ActivityChange {
  if (typeof value !== 'object' || value === null || !('field' in value) || !FIELDS.includes(value.field as ChangedField) ||
    !('from' in value) || !isNullableText(value.from) || !('to' in value) || !isNullableText(value.to)) {
    throw new Error('Alteração de histórico inválida.');
  }
  return { field: value.field as ChangedField, from: value.from, to: value.to };
}

export function activityPageFromResponse(value: unknown): ActivityPage {
  if (typeof value !== 'object' || value === null || !('data' in value) || !Array.isArray(value.data) ||
    !('nextCursor' in value) || !isNullableText(value.nextCursor)) {
    throw new Error('Resposta de histórico inválida.');
  }
  const data = value.data.map((item: unknown): Activity => {
    if (typeof item !== 'object' || item === null ||
      !('id' in item) || !isText(item.id) || !('type' in item) || !TYPES.includes(item.type as ActivityType) ||
      !('taskId' in item) || !isNullableText(item.taskId) || !('taskTitle' in item) || !isText(item.taskTitle) ||
      !('createdAt' in item) || !isText(item.createdAt) || Number.isNaN(Date.parse(item.createdAt)) ||
      !('changes' in item) || (item.changes !== null && !Array.isArray(item.changes)) ||
      !('actor' in item) || typeof item.actor !== 'object' || item.actor === null ||
      !('id' in item.actor) || !isText(item.actor.id) || !('name' in item.actor) || !isText(item.actor.name)) {
      throw new Error('Atividade inválida.');
    }
    return {
      id: item.id, type: item.type as ActivityType, taskId: item.taskId, taskTitle: item.taskTitle, createdAt: item.createdAt,
      changes: item.changes === null ? null : (item.changes as unknown[]).map(changeFromResponse),
      actor: { id: item.actor.id, name: item.actor.name },
    };
  });
  return { data, nextCursor: value.nextCursor };
}

const FIELD_LABELS: Readonly<Record<ChangedField, string>> = {
  title: 'o título', description: 'a descrição', status: 'o status', assignee: 'o responsável', dueDate: 'o prazo',
};

function valueLabel(field: ChangedField, value: string | null): string {
  if (field === 'assignee') return value ?? 'sem responsável';
  if (field === 'dueDate') {
    return value === null ? 'sem prazo' : new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (field === 'status' && value) return statusLabel(value as TaskStatus);
  return value ?? '—';
}

/** Descreve uma alteração: "o status de “A fazer” para “Em andamento”". */
export function describeChange(change: ActivityChange): string {
  if (change.field === 'description') return FIELD_LABELS.description;
  return `${FIELD_LABELS[change.field]} de “${valueLabel(change.field, change.from)}” para “${valueLabel(change.field, change.to)}”`;
}

/** Ação da atividade, sem o nome de quem a realizou. */
export function describeActivity(activity: Activity, includeTitle = true): string {
  const title = includeTitle ? ` “${activity.taskTitle}”` : '';
  switch (activity.type) {
    case 'TASK_CREATED': return includeTitle ? `criou a tarefa${title}` : 'criou a tarefa';
    case 'TASK_DELETED': return `excluiu a tarefa${title}`;
    case 'COMMENT_ADDED': return includeTitle ? `comentou em${title}` : 'comentou';
    case 'TASK_UPDATED': {
      const changes = activity.changes ?? [];
      const target = includeTitle ? `${title}:` : '';
      return changes.length === 0
        ? `atualizou a tarefa${title}`
        : `alterou${target} ${changes.map(describeChange).join('; ')}`;
    }
  }
}
