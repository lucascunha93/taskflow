import { describeIssue } from '../features/sync/sync-issues.page';
import { syncSummary } from '../features/tasks/tasks.page';
import { OutboxOp } from './outbox.models';
import { applyOutbox } from './overlay';
import { ServerTask, dueDateFromInput, dueDateToInput, sameValue } from './task.models';

const server = (id: string, updatedAt: string, title = id): ServerTask => ({
  id, organizationId: 'o', version: 1, creatorId: 'u', createdAt: updatedAt, updatedAt,
  title, description: null, status: 'TODO', assigneeId: null, projectId: null, dueDate: null,
});
const base = { scope: 's', organizationId: 'o', createdAt: '2026-02-01T00:00:00.000Z', attempts: 0 };

describe('local view of tasks', () => {
  it('applies queued operations over the server state', () => {
    const ops: OutboxOp[] = [
      { ...base, seq: 1, kind: 'create', taskId: 'new', state: 'pending', fields: { ...server('x', '').valueOf(), title: 'Nova' } as never },
      { ...base, seq: 2, kind: 'update', taskId: 'a', state: 'conflict', baseVersion: 1, base: server('a', '') as never, changes: { title: 'Editada' } },
      { ...base, seq: 3, kind: 'delete', taskId: 'b', state: 'pending', baseVersion: 1 },
      { ...base, seq: 4, kind: 'delete', taskId: 'c', state: 'failed', baseVersion: 1, error: 'sem permissão' },
    ];
    const views = applyOutbox([server('a', '2026-01-01T00:00:00Z'), server('b', '2026-01-02T00:00:00Z'), server('c', '2026-01-03T00:00:00Z')], ops);
    expect(views.map((task) => [task.id, task.sync, task.title])).toEqual([
      ['a', 'conflict', 'Editada'], ['new', 'pending', 'Nova'], ['c', 'failed', 'c'],
    ]);
    expect(views.find((task) => task.id === 'new')?.localOnly).toBe(true);
    expect(views.find((task) => task.id === 'c')?.deleting).toBe(true);
  });

  it('compares due dates by instant and converts date inputs to UTC midnight', () => {
    expect(dueDateFromInput('2026-03-10')).toBe('2026-03-10T00:00:00.000Z');
    expect(dueDateFromInput('')).toBeNull();
    expect(dueDateToInput('2026-03-10T00:00:00.000Z')).toBe('2026-03-10');
    expect(sameValue('dueDate', '2026-03-10T00:00:00Z', '2026-03-10T00:00:00.000Z')).toBe(true);
    expect(sameValue('description', undefined, null)).toBe(true);
    expect(sameValue('title', 'a', 'b')).toBe(false);
  });
});

describe('sync messages', () => {
  it('summarizes the sync state with the queue size', () => {
    expect(syncSummary('offline', 2, null).text).toBe('Sem conexão · 2 alteração(ões) na fila');
    expect(syncSummary('idle', 0, null).text).toBe('Ainda não sincronizado');
    expect(syncSummary('idle', 0, '2026-01-01T10:05:00Z').text).toMatch(/^Sincronizado às \d{2}:\d{2}$/);
    expect(syncSummary('signed-out', 1, null).icon).toBe('alert-circle-outline');
  });

  it('explains each kind of issue with the matching choices', () => {
    const members = [{ id: 'm1', name: 'Bia' }, { id: 'm2', name: 'Caio' }];
    const conflict = describeIssue({
      ...base, seq: 1, kind: 'update', taskId: 't', state: 'conflict', baseVersion: 2, base: {} as never, changes: { assigneeId: 'm1' },
      conflict: { reason: 'modified', server: null, fields: [
        { field: 'assigneeId', local: 'm1', server: 'm2' }, { field: 'status', local: 'DONE', server: 'CANCELLED' },
      ] },
    }, 'Relatório', members, []);
    expect(conflict.details).toEqual([
      'Responsável: seu valor “Bia”, no servidor “Caio”', 'Status: seu valor “Concluída”, no servidor “Cancelada”',
    ]);
    expect([conflict.keepLabel, conflict.discardLabel]).toEqual(['Manter meus valores', 'Usar os do servidor']);

    expect(describeIssue({ ...base, seq: 2, kind: 'delete', taskId: 't', state: 'conflict', baseVersion: 3 }, 'X', [], []).keepLabel)
      .toBe('Excluir mesmo assim');
    expect(describeIssue({
      ...base, seq: 3, kind: 'update', taskId: 't', state: 'conflict', baseVersion: 1, base: {} as never, changes: {},
      conflict: { reason: 'deleted', fields: [], server: null },
    }, 'X', [], []).keepLabel).toBe('Recriar com minhas alterações');
    expect(describeIssue({ ...base, seq: 4, kind: 'create', taskId: 't', state: 'failed', fields: {} as never, error: 'Limite do plano.' }, 'X', [], []))
      .toMatchObject({ summary: 'A criação foi recusada pelo servidor: Limite do plano.', keepLabel: 'Tentar novamente' });
  });
});
