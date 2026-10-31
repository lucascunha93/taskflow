import { TaskStatus } from '../tasks/task.models';

export interface DashboardTask {
  id: string;
  organizationId: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  updatedAt: string;
}

export interface DashboardSummary {
  total: number;
  counts: Record<TaskStatus, number>;
  asOf: string;
  dueUntil: string;
  myTasks: DashboardTask[];
  dueSoon: DashboardTask[];
  recentlyUpdated: DashboardTask[];
}
