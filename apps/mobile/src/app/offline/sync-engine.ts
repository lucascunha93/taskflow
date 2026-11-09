import { LocalStore } from './local-store';
import { CreateOp, DeleteOp, FieldConflict, OutboxOp, Resolution, UpdateOp } from './outbox.models';
import { applyOutbox } from './overlay';
import { ApiError, TasksApi } from './tasks-api';
import { ServerTask, TASK_FIELDS, TaskFields, TaskView, fieldsOf, sameValue } from './task.models';

/** Quantas tarefas (mais recentes) ficam disponíveis offline por organização. */
export const OFFLINE_TASK_LIMIT = 500;
const PAGE_SIZE = 100;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
/** Tentativas automáticas seguidas de reaplicar uma alteração após 409 sem conflito real. */
const MAX_REBASES = 3;

export type PushOutcome = 'done' | 'retry' | 'auth';

/** Exclusão mútua simples para as leituras e escritas da fila. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Erro de uso: a tarefa tem uma decisão pendente e não aceita nova alteração. */
export class TaskLockedError extends Error {}

/**
 * Regras de funcionamento offline e sincronização das tarefas.
 *
 * Toda alteração é aplicada primeiro no aparelho e registrada na fila (outbox).
 * O envio respeita a ordem, uma operação por vez, e usa a concorrência otimista
 * da API (`version`):
 *
 * - Criação: o aparelho gera o UUID da tarefa; reenviar é seguro (idempotente).
 * - Edições seguidas da mesma tarefa ainda não enviadas são unificadas; criar e
 *   excluir antes de enviar descarta as duas operações.
 * - 409 na atualização: comparação em três vias por campo entre a base local, a
 *   alteração local e o servidor. Campos alterados só de um lado são mesclados
 *   automaticamente; o mesmo campo alterado nos dois lados com valores
 *   diferentes vira conflito e o usuário decide. Nada é sobrescrito em silêncio.
 * - 409 na exclusão: a tarefa mudou no servidor; o usuário decide se exclui.
 * - Tarefa excluída no servidor com edição local: conflito; o usuário pode recriá-la.
 * - 400, 403 e 404 de organização: a operação fica com falha e a mensagem da API.
 * - Falha de rede ou erro 5xx: nova tentativa com espera exponencial (até 5 min).
 * - 401 (sessão expirada): o envio para e a fila é mantida até um novo login.
 */
export class SyncEngine {
  private readonly lock = new Mutex();
  private inFlight: number | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly api: TasksApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------- leitura

  async view(scope: string): Promise<TaskView[]> {
    const [server, ops] = await Promise.all([this.store.getTasks(scope), this.store.getOps(scope)]);
    return applyOutbox(server, ops);
  }

  async issues(scope?: string): Promise<OutboxOp[]> {
    return (await this.store.getOps(scope)).filter((op) => op.state !== 'pending');
  }

  async pendingCount(scope?: string): Promise<number> {
    return (await this.store.getOps(scope)).length;
  }

  // ------------------------------------------------------- alterações locais

  async create(scope: string, organizationId: string, fields: TaskFields): Promise<string> {
    const taskId = crypto.randomUUID();
    await this.lock.run(() => this.store.addOp({
      kind: 'create', scope, organizationId, taskId, fields: fieldsOf(fields),
      createdAt: this.now().toISOString(), state: 'pending', attempts: 0,
    }));
    return taskId;
  }

  async update(scope: string, organizationId: string, taskId: string, changes: Partial<TaskFields>): Promise<void> {
    await this.lock.run(async () => {
      const ops = (await this.store.getOps(scope)).filter((op) => op.taskId === taskId);
      this.assertEditable(ops);
      const last = ops.at(-1);
      if (last && last.seq !== this.inFlight) {
        if (last.kind === 'delete') throw new TaskLockedError('A tarefa foi excluída neste aparelho.');
        if (last.kind === 'create') {
          last.fields = { ...last.fields, ...changes };
          await this.store.putOp(last);
          return;
        }
        // Edições seguidas antes do envio viram uma só; a base continua a original.
        last.changes = withoutUnchanged({ ...last.changes, ...changes }, last.base);
        if (Object.keys(last.changes).length === 0) await this.store.deleteOp(last.seq!);
        else await this.store.putOp(last);
        return;
      }
      const current = applyOutbox(await this.taskSnapshot(scope, taskId), ops).find((task) => task.id === taskId);
      if (!current) throw new TaskLockedError('Tarefa não encontrada neste aparelho.');
      const base = fieldsOf(current);
      const effective = withoutUnchanged(changes, base);
      if (Object.keys(effective).length === 0) return;
      await this.store.addOp({
        kind: 'update', scope, organizationId, taskId, baseVersion: current.version, base, changes: effective,
        createdAt: this.now().toISOString(), state: 'pending', attempts: 0,
      });
    });
  }

  async remove(scope: string, organizationId: string, taskId: string): Promise<void> {
    await this.lock.run(async () => {
      const ops = (await this.store.getOps(scope)).filter((op) => op.taskId === taskId);
      this.assertEditable(ops);
      const create = ops.find((op): op is CreateOp => op.kind === 'create');
      if (create && create.seq !== this.inFlight) {
        // Nunca chegou ao servidor: basta descartar tudo o que existe dela na fila.
        for (const op of ops) await this.store.deleteOp(op.seq!);
        return;
      }
      for (const op of ops) if (op.seq !== this.inFlight && op.kind === 'update') await this.store.deleteOp(op.seq!);
      const server = await this.store.getTask(scope, taskId);
      await this.store.addOp({
        kind: 'delete', scope, organizationId, taskId, baseVersion: create ? 0 : server?.version ?? 0,
        createdAt: this.now().toISOString(), state: 'pending', attempts: 0,
      });
    });
  }

  /** Decisão do usuário sobre uma operação em conflito ou com falha. */
  async resolve(seq: number, resolution: Resolution): Promise<void> {
    await this.lock.run(async () => {
      const op = (await this.store.getOps()).find((item) => item.seq === seq);
      if (!op || op.state === 'pending') return;
      const reset = { state: 'pending' as const, attempts: 0, error: undefined, conflict: undefined, retryAt: undefined };

      if (op.state === 'failed') {
        if (resolution === 'discard') await this.discard(op);
        else await this.store.putOp({ ...op, ...reset });
        return;
      }

      const conflict = op.conflict;
      if (op.kind === 'update' && conflict?.reason === 'deleted') {
        if (resolution === 'discard') return this.discard(op);
        // Recria a tarefa com o estado local, usando o mesmo identificador.
        await this.store.deleteOp(seq);
        await this.store.addOp({
          kind: 'create', scope: op.scope, organizationId: op.organizationId, taskId: op.taskId,
          fields: { ...op.base, ...op.changes }, createdAt: this.now().toISOString(), state: 'pending', attempts: 0,
        });
        return;
      }
      if (op.kind === 'update') {
        if (resolution === 'discard') {
          // Mantém o servidor nos campos em conflito e envia o restante.
          const conflicted = new Set(conflict?.fields.map((item) => item.field));
          const changes = Object.fromEntries(Object.entries(op.changes).filter(([field]) => !conflicted.has(field as never)));
          if (Object.keys(changes).length === 0) await this.store.deleteOp(seq);
          else await this.store.putOp({ ...op, ...reset, changes });
        } else {
          await this.store.putOp({ ...op, ...reset });
        }
        return;
      }
      if (op.kind === 'delete') {
        if (resolution === 'discard') await this.store.deleteOp(seq);
        else await this.store.putOp({ ...op, ...reset });
      }
    });
  }

  // ------------------------------------------------------------------ envio

  /** Envia a fila de todos os escopos, em ordem. */
  async push(): Promise<PushOutcome> {
    for (let guard = 0; guard < 1000; guard++) {
      const op = await this.lock.run(async () => {
        const next = this.next(await this.store.getOps());
        this.inFlight = next?.seq ?? null;
        return next;
      });
      if (!op) return 'done';
      try {
        await this.send(op);
      } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 401) return 'auth';
        if (!(error instanceof ApiError) || error.transient) {
          await this.lock.run(() => this.scheduleRetry(op));
          return 'retry';
        }
        throw error;
      } finally {
        this.inFlight = null;
      }
    }
    return 'retry';
  }

  /** Atualiza a cópia local com as tarefas mais recentes da organização. */
  async pull(scope: string, organizationId: string): Promise<void> {
    const tasks: ServerTask[] = [];
    for (let page = 1; tasks.length < OFFLINE_TASK_LIMIT; page++) {
      const result = await this.api.list(organizationId, page, PAGE_SIZE);
      tasks.push(...result.data);
      if (page >= result.totalPages || result.data.length === 0) break;
    }
    await this.lock.run(async () => {
      // Tarefas com operações na fila continuam no cache mesmo fora da janela recente.
      const keep = new Set((await this.store.getOps(scope)).map((op) => op.taskId));
      await this.store.replaceTasks(scope, tasks.slice(0, OFFLINE_TASK_LIMIT), keep);
    });
  }

  // ---------------------------------------------------------------- interno

  private next(ops: OutboxOp[]): OutboxOp | undefined {
    const seen = new Set<string>();
    const now = this.now().getTime();
    for (const op of ops) {
      if (seen.has(op.taskId)) continue;
      // Somente a primeira operação de cada tarefa pode ser enviada; as demais esperam.
      seen.add(op.taskId);
      if (op.state === 'pending' && (!op.retryAt || Date.parse(op.retryAt) <= now)) return op;
    }
    return undefined;
  }

  private async send(op: OutboxOp): Promise<void> {
    if (op.kind === 'create') return this.sendCreate(op);
    if (op.kind === 'update') return this.sendUpdate(op);
    return this.sendDelete(op);
  }

  private async sendCreate(op: CreateOp): Promise<void> {
    try {
      const created = await this.api.create(op.organizationId, { id: op.taskId, ...op.fields });
      await this.lock.run(() => this.confirm(op, created));
    } catch (error: unknown) {
      await this.failIfRejected(op, error);
    }
  }

  private async sendUpdate(op: UpdateOp, rebases = 0): Promise<void> {
    try {
      const updated = await this.api.update(op.organizationId, op.taskId, { version: op.baseVersion, ...op.changes });
      await this.lock.run(() => this.confirm(op, updated));
      return;
    } catch (error: unknown) {
      if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 404)) {
        return this.failIfRejected(op, error);
      }
    }

    const server = await this.fetchOrNull(op);
    const next = await this.lock.run(async () => {
      const current = await this.reload(op);
      if (!current || current.kind !== 'update') return null;
      if (!server) {
        await this.store.deleteTask(op.scope, op.taskId);
        await this.store.putOp({ ...current, state: 'conflict', conflict: { reason: 'deleted', fields: [], server: null } });
        return null;
      }
      await this.store.putTask(op.scope, server);
      const { changes, conflicts } = threeWay(current, server);
      const rebased: UpdateOp = { ...current, baseVersion: server.version, base: fieldsOf(server) };
      if (conflicts.length > 0) {
        await this.store.putOp({ ...rebased, state: 'conflict', conflict: { reason: 'modified', fields: conflicts, server } });
        return null;
      }
      if (Object.keys(changes).length === 0) {
        await this.store.deleteOp(current.seq!);
        return null;
      }
      const merged = { ...rebased, changes };
      await this.store.putOp(merged);
      return merged;
    });
    // Sem conflito real: reenvia a alteração mesclada sobre a versão atual.
    if (next && rebases < MAX_REBASES) await this.sendUpdate(next, rebases + 1);
  }

  private async sendDelete(op: DeleteOp): Promise<void> {
    try {
      await this.api.remove(op.organizationId, op.taskId, op.baseVersion);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        const server = await this.fetchOrNull(op);
        await this.lock.run(async () => {
          const current = await this.reload(op);
          if (current?.kind !== 'delete') return;
          if (!server) {
            await this.store.deleteOp(current.seq!);
            await this.store.deleteTask(op.scope, op.taskId);
            return;
          }
          await this.store.putTask(op.scope, server);
          await this.store.putOp({
            ...current, baseVersion: server.version, state: 'conflict',
            conflict: { reason: 'modified', fields: [], server },
          });
        });
        return;
      }
      // 404: já não existe no servidor, que é o resultado desejado.
      if (!(error instanceof ApiError) || error.status !== 404) return this.failIfRejected(op, error);
    }
    await this.lock.run(async () => {
      await this.store.deleteOp(op.seq!);
      await this.store.deleteTask(op.scope, op.taskId);
    });
  }

  /** Grava a resposta do servidor, remove a operação e reposiciona as seguintes da mesma tarefa. */
  private async confirm(op: OutboxOp, server: ServerTask): Promise<void> {
    await this.store.putTask(op.scope, server);
    await this.store.deleteOp(op.seq!);
    const from = op.kind === 'create' ? 0 : (op as UpdateOp).baseVersion;
    for (const later of await this.store.getOps(op.scope)) {
      if (later.taskId !== op.taskId || later.kind === 'create' || later.baseVersion !== from) continue;
      later.baseVersion = server.version;
      if (later.kind === 'update') later.base = { ...later.base, ...fieldsOf(server) };
      await this.store.putOp(later);
    }
  }

  private async failIfRejected(op: OutboxOp, error: unknown): Promise<void> {
    if (!(error instanceof ApiError) || error.transient || error.status === 401) throw error;
    await this.lock.run(async () => {
      const current = await this.reload(op);
      if (!current) return;
      await this.store.putOp({ ...current, state: 'failed', error: rejectionMessage(error) });
    });
  }

  private async scheduleRetry(op: OutboxOp): Promise<void> {
    const current = await this.reload(op);
    if (!current) return;
    const attempts = current.attempts + 1;
    const delay = Math.min(MAX_RETRY_DELAY_MS, 5_000 * 2 ** (attempts - 1));
    await this.store.putOp({ ...current, attempts, retryAt: new Date(this.now().getTime() + delay).toISOString() });
  }

  private async fetchOrNull(op: OutboxOp): Promise<ServerTask | null> {
    try {
      return await this.api.get(op.organizationId, op.taskId);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  private async reload(op: OutboxOp): Promise<OutboxOp | undefined> {
    return (await this.store.getOps(op.scope)).find((item) => item.seq === op.seq);
  }

  private async discard(op: OutboxOp): Promise<void> {
    await this.store.deleteOp(op.seq!);
    if (op.kind === 'update' && op.conflict?.reason === 'deleted') await this.store.deleteTask(op.scope, op.taskId);
    // Uma criação recusada leva junto as alterações seguintes da mesma tarefa.
    if (op.kind === 'create') {
      for (const later of await this.store.getOps(op.scope)) {
        if (later.taskId === op.taskId) await this.store.deleteOp(later.seq!);
      }
    }
  }

  private async taskSnapshot(scope: string, taskId: string): Promise<ServerTask[]> {
    const task = await this.store.getTask(scope, taskId);
    return task ? [task] : [];
  }

  private assertEditable(ops: OutboxOp[]): void {
    if (ops.some((op) => op.state !== 'pending')) {
      throw new TaskLockedError('Resolva o conflito ou a falha de sincronização desta tarefa antes de alterá-la.');
    }
  }
}

function withoutUnchanged(changes: Partial<TaskFields>, base: TaskFields): Partial<TaskFields> {
  return Object.fromEntries(
    Object.entries(changes).filter(([field, value]) => !sameValue(field as never, value, base[field as keyof TaskFields])),
  ) as Partial<TaskFields>;
}

/** Comparação em três vias de cada campo alterado localmente. */
function threeWay(op: UpdateOp, server: ServerTask): { changes: Partial<TaskFields>; conflicts: FieldConflict[] } {
  const changes: Partial<TaskFields> = {};
  const conflicts: FieldConflict[] = [];
  for (const field of TASK_FIELDS) {
    if (!(field in op.changes)) continue;
    const local = op.changes[field];
    if (sameValue(field, server[field], local)) continue; // o servidor já tem o valor local
    if (sameValue(field, server[field], op.base[field])) {
      (changes as Record<string, unknown>)[field] = local; // só o aparelho alterou
    } else {
      conflicts.push({ field, local, server: server[field] });
    }
  }
  return { changes, conflicts };
}

function rejectionMessage(error: ApiError): string {
  const message = error.apiMessage;
  if (error.status === 403) return message ?? 'Operação não permitida.';
  if (error.status === 404) return 'Organização não encontrada ou acesso removido.';
  if (error.status === 400) return message ? `Dados inválidos: ${message}` : 'Dados inválidos.';
  return message ?? `Erro ${error.status}.`;
}
