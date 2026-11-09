export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export const TASK_STATUSES: readonly { value: TaskStatus; label: string }[] = [
  { value: 'TODO', label: 'A fazer' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluída' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

export const statusLabel = (status: TaskStatus): string =>
  TASK_STATUSES.find((item) => item.value === status)?.label ?? status;

/** Campos editáveis de uma tarefa, como a API os aceita. */
export interface TaskFields {
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  projectId: string | null;
  /** ISO 8601 completo (meia-noite UTC para datas escolhidas no app) ou nulo. */
  dueDate: string | null;
}

export const TASK_FIELDS = ['title', 'description', 'status', 'assigneeId', 'projectId', 'dueDate'] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

/** Estado da tarefa no servidor, como recebido na última resposta ou sincronização. */
export interface ServerTask extends TaskFields {
  id: string;
  organizationId: string;
  version: number;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskSyncState = 'synced' | 'pending' | 'conflict' | 'failed';

/** Tarefa exibida no app: estado do servidor com as alterações locais ainda não enviadas. */
export interface TaskView extends ServerTask {
  sync: TaskSyncState;
  /** Criada no aparelho e ainda não confirmada pelo servidor. */
  localOnly: boolean;
  /** Excluída no aparelho, aguardando confirmação (visível apenas com conflito ou falha). */
  deleting: boolean;
}

export interface Member {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
}

export function fieldsOf(task: TaskFields): TaskFields {
  return {
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    assigneeId: task.assigneeId ?? null,
    projectId: task.projectId ?? null,
    dueDate: task.dueDate ?? null,
  };
}

/** Igualdade de valores de campo: datas pelo instante, ausente igual a nulo. */
export function sameValue(field: TaskField, a: unknown, b: unknown): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  if (field === 'dueDate') return Date.parse(String(left)) === Date.parse(String(right));
  return left === right;
}

/** Converte a data de um campo `type="date"` (AAAA-MM-DD) para o formato da API. */
export function dueDateFromInput(value: string): string | null {
  if (!value) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function dueDateToInput(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

/** Valida e normaliza uma tarefa recebida da API. */
export function serverTaskFromResponse(value: unknown): ServerTask {
  const task = value as Partial<ServerTask> | null;
  if (!task || typeof task.id !== 'string' || typeof task.organizationId !== 'string' ||
    typeof task.title !== 'string' || typeof task.version !== 'number' || typeof task.status !== 'string' ||
    typeof task.updatedAt !== 'string' || typeof task.createdAt !== 'string') {
    throw new Error('Resposta de tarefa inválida.');
  }
  return {
    id: task.id,
    organizationId: task.organizationId,
    version: task.version,
    creatorId: typeof task.creatorId === 'string' ? task.creatorId : '',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...fieldsOf(task as TaskFields),
  };
}
