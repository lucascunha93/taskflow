export type ChangedField = 'title' | 'description' | 'status' | 'assignee' | 'dueDate' | 'project';

/**
 * Alteração registrada no histórico. A descrição registra apenas que mudou
 * (`from` e `to` nulos), para não duplicar textos longos no histórico.
 */
export interface ActivityChange {
  field: ChangedField;
  from: string | null;
  to: string | null;
}

export interface TaskSnapshot {
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | string | null;
  assignee: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
}

export function taskChanges(before: TaskSnapshot, after: TaskSnapshot): ActivityChange[] {
  const changes: ActivityChange[] = [];
  if (before.title !== after.title) changes.push({ field: 'title', from: before.title, to: after.title });
  if (before.description !== after.description) changes.push({ field: 'description', from: null, to: null });
  if (before.status !== after.status) changes.push({ field: 'status', from: before.status, to: after.status });
  if ((before.assignee?.id ?? null) !== (after.assignee?.id ?? null)) {
    changes.push({ field: 'assignee', from: before.assignee?.name ?? null, to: after.assignee?.name ?? null });
  }
  const beforeDue = isoOrNull(before.dueDate);
  const afterDue = isoOrNull(after.dueDate);
  if (beforeDue !== afterDue) changes.push({ field: 'dueDate', from: beforeDue, to: afterDue });
  if ((before.project?.id ?? null) !== (after.project?.id ?? null)) {
    changes.push({ field: 'project', from: before.project?.name ?? null, to: after.project?.name ?? null });
  }
  return changes;
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
