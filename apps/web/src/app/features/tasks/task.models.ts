export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskSort = 'createdAt' | 'updatedAt' | 'dueDate' | 'title';
export type SortOrder = 'asc' | 'desc';

export interface TaskRecord {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  creatorId: string;
  assigneeId: string | null;
  version: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task extends TaskRecord {
  creator: { id: string; name: string };
  assignee: { id: string; name: string } | null;
}

export interface TaskPage {
  data: Task[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface TaskQuery {
  page: number;
  limit: number;
  status: TaskStatus | '';
  assigneeId: string;
  creatorId: string;
  search: string;
  dueDateFrom: string;
  dueDateTo: string;
  sortBy: TaskSort;
  sortOrder: SortOrder;
}

export interface CreateTask {
  title: string;
  description?: string;
  status: TaskStatus;
  assigneeId?: string;
  dueDate?: string;
}

export interface UpdateTask {
  version: number;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export const TASK_STATUSES: readonly { value: TaskStatus; label: string }[] = [
  { value: 'TODO', label: 'A fazer' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluída' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

export function statusLabel(status: TaskStatus): string {
  return TASK_STATUSES.find((item) => item.value === status)?.label ?? status;
}
