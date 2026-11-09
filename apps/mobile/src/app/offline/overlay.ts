import { OutboxOp } from './outbox.models';
import { ServerTask, TaskFields, TaskView, fieldsOf } from './task.models';

const rank = { synced: 0, pending: 1, failed: 2, conflict: 3 } as const;

/**
 * Visão local das tarefas: o estado do servidor com as operações da fila
 * aplicadas em ordem. Uma exclusão pendente remove a tarefa da lista; com
 * conflito ou falha, ela continua visível e marcada.
 */
export function applyOutbox(server: readonly ServerTask[], ops: readonly OutboxOp[]): TaskView[] {
  const views = new Map<string, TaskView>();
  for (const task of server) views.set(task.id, { ...task, sync: 'synced', localOnly: false, deleting: false });

  for (const op of ops) {
    const state = op.state === 'pending' ? 'pending' : op.state;
    const current = views.get(op.taskId);
    if (op.kind === 'create') {
      views.set(op.taskId, {
        id: op.taskId, organizationId: op.organizationId, version: 0, creatorId: '', createdAt: op.createdAt,
        updatedAt: op.createdAt, ...fieldsOf(op.fields), sync: state, localOnly: true, deleting: false,
      });
      continue;
    }
    if (!current) {
      // Tarefa fora do cache (ex.: excluída no servidor): só aparece se houver decisão pendente.
      if (op.state !== 'pending' && op.kind === 'update') {
        views.set(op.taskId, {
          id: op.taskId, organizationId: op.organizationId, version: op.baseVersion, creatorId: '',
          createdAt: op.createdAt, updatedAt: op.createdAt, ...fieldsOf({ ...op.base, ...op.changes } as TaskFields),
          sync: state, localOnly: false, deleting: false,
        });
      }
      continue;
    }
    const sync = rank[state] > rank[current.sync] ? state : current.sync;
    if (op.kind === 'update') {
      views.set(op.taskId, { ...current, ...op.changes, updatedAt: op.createdAt, sync });
    } else if (op.state === 'pending') {
      views.delete(op.taskId);
    } else {
      views.set(op.taskId, { ...current, sync, deleting: true });
    }
  }

  return [...views.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
