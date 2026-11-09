import { MemoryStore } from './local-store';
import { OFFLINE_TASK_LIMIT, SyncEngine, TaskLockedError } from './sync-engine';
import { ApiError, TaskPage, TasksApi } from './tasks-api';
import { ServerTask, TaskFields } from './task.models';

const ORG = 'org-1';
const SCOPE = `user-1:${ORG}`;

const fields = (overrides: Partial<TaskFields> = {}): TaskFields => ({
  title: 'Tarefa', description: null, status: 'TODO', assigneeId: null, projectId: null, dueDate: null, ...overrides,
});

/** Servidor simulado com as mesmas regras de versão da API. */
class FakeServer implements TasksApi {
  readonly tasks = new Map<string, ServerTask>();
  readonly calls: string[] = [];
  offline = false;
  private clock = 0;
  private readonly failures: { method: string; error: ApiError }[] = [];
  /** Executado antes de cada chamada; permite intercalar ações durante o envio. */
  beforeCall: ((method: string) => Promise<void>) | null = null;
  /** Aplica a operação mas perde a resposta (falha de rede depois do commit). */
  loseNextResponse = false;

  failNext(method: string, status: number, body: unknown = null): void {
    this.failures.push({ method, error: new ApiError(status, body) });
  }

  seed(id: string, overrides: Partial<TaskFields> = {}): ServerTask {
    const task = this.stamp({ id, organizationId: ORG, version: 1, creatorId: 'user-1', createdAt: '', updatedAt: '', ...fields(overrides) });
    this.tasks.set(id, task);
    return task;
  }

  /** Alteração feita por outra pessoa. */
  remoteEdit(id: string, changes: Partial<TaskFields>): void {
    const task = this.tasks.get(id)!;
    this.tasks.set(id, this.stamp({ ...task, ...changes, version: task.version + 1 }));
  }

  async list(_organizationId: string, page: number, limit: number): Promise<TaskPage> {
    await this.enter('list');
    const all = [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { data: all.slice((page - 1) * limit, page * limit), totalPages: Math.ceil(all.length / limit) };
  }

  async get(_organizationId: string, taskId: string): Promise<ServerTask> {
    await this.enter('get');
    const task = this.tasks.get(taskId);
    if (!task) throw new ApiError(404);
    return structuredClone(task);
  }

  async create(organizationId: string, body: TaskFields & { id: string }): Promise<ServerTask> {
    await this.enter('create');
    const existing = this.tasks.get(body.id);
    if (existing) return structuredClone(existing);
    const { id, ...rest } = body;
    const task = this.stamp({ id, organizationId, version: 1, creatorId: 'user-1', createdAt: '', updatedAt: '', ...fields(rest) });
    this.tasks.set(id, task);
    return this.respond(task);
  }

  async update(_organizationId: string, taskId: string, body: Partial<TaskFields> & { version: number }): Promise<ServerTask> {
    await this.enter('update');
    const task = this.tasks.get(taskId);
    if (!task) throw new ApiError(404);
    if (task.version !== body.version) throw new ApiError(409);
    const changes: Partial<TaskFields & { version: number }> = { ...body };
    delete changes.version;
    const updated = this.stamp({ ...task, ...changes, version: task.version + 1 });
    this.tasks.set(taskId, updated);
    return this.respond(updated);
  }

  async remove(_organizationId: string, taskId: string, version: number): Promise<void> {
    await this.enter('remove');
    const task = this.tasks.get(taskId);
    if (!task) throw new ApiError(404);
    if (task.version !== version) throw new ApiError(409);
    this.tasks.delete(taskId);
  }

  private async enter(method: string): Promise<void> {
    this.calls.push(method);
    await this.beforeCall?.(method);
    if (this.offline) throw new ApiError(0);
    const index = this.failures.findIndex((failure) => failure.method === method);
    if (index >= 0) throw this.failures.splice(index, 1)[0].error;
  }

  private respond(task: ServerTask): ServerTask {
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new ApiError(0);
    }
    return structuredClone(task);
  }

  private stamp(task: ServerTask): ServerTask {
    const time = new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)).toISOString();
    return { ...task, createdAt: task.createdAt || time, updatedAt: time };
  }
}

describe('SyncEngine', () => {
  let store: MemoryStore;
  let server: FakeServer;
  let now: Date;
  let engine: SyncEngine;

  beforeEach(() => {
    store = new MemoryStore();
    server = new FakeServer();
    now = new Date('2026-01-01T12:00:00Z');
    engine = new SyncEngine(store, server, () => now);
  });

  const view = async (id: string) => (await engine.view(SCOPE)).find((task) => task.id === id);
  const ops = () => store.getOps();
  async function synced(id: string, overrides: Partial<TaskFields> = {}): Promise<ServerTask> {
    const task = server.seed(id, overrides);
    await engine.pull(SCOPE, ORG);
    return task;
  }

  it('creates offline with a device-generated id and sends it once online', async () => {
    server.offline = true;
    const id = await engine.create(SCOPE, ORG, fields({ title: 'Criada offline' }));
    expect(await view(id)).toMatchObject({ title: 'Criada offline', sync: 'pending', localOnly: true });
    expect(await engine.push()).toBe('retry');
    expect((await ops())[0]).toMatchObject({ attempts: 1, retryAt: '2026-01-01T12:00:05.000Z' });

    server.offline = false;
    expect(await engine.push()).toBe('done'); // ainda dentro da espera
    expect(server.tasks.has(id)).toBe(false);
    now = new Date('2026-01-01T12:00:06Z');
    expect(await engine.push()).toBe('done');
    expect(server.tasks.get(id)).toMatchObject({ id, title: 'Criada offline', version: 1 });
    expect(await view(id)).toMatchObject({ sync: 'synced', localOnly: false, version: 1 });
    expect(await ops()).toEqual([]);
  });

  it('does not duplicate a creation whose response was lost', async () => {
    const id = await engine.create(SCOPE, ORG, fields());
    server.loseNextResponse = true;
    expect(await engine.push()).toBe('retry');
    expect(server.tasks.size).toBe(1);
    now = new Date('2026-01-01T13:00:00Z');
    expect(await engine.push()).toBe('done');
    expect(server.tasks.size).toBe(1);
    expect(await view(id)).toMatchObject({ sync: 'synced' });
  });

  it('merges edits made before sending and drops create + delete pairs', async () => {
    const id = await engine.create(SCOPE, ORG, fields({ title: 'Primeira' }));
    await engine.update(SCOPE, ORG, id, { status: 'IN_PROGRESS' });
    await engine.update(SCOPE, ORG, id, { title: 'Segunda' });
    expect(await ops()).toHaveLength(1);
    expect((await ops())[0]).toMatchObject({ kind: 'create', fields: { title: 'Segunda', status: 'IN_PROGRESS' } });

    const other = await engine.create(SCOPE, ORG, fields({ title: 'Descartável' }));
    await engine.remove(SCOPE, ORG, other);
    expect((await ops()).map((op) => op.taskId)).toEqual([id]);
    await engine.push();
    expect(server.calls.filter((call) => call === 'create')).toHaveLength(1);
  });

  it('unifies successive updates and removes an update that returns to the original values', async () => {
    await synced('t1', { title: 'Original' });
    await engine.update(SCOPE, ORG, 't1', { title: 'Mudou' });
    await engine.update(SCOPE, ORG, 't1', { status: 'DONE' });
    expect(await ops()).toHaveLength(1);
    expect((await ops())[0]).toMatchObject({ kind: 'update', baseVersion: 1, changes: { title: 'Mudou', status: 'DONE' } });
    await engine.update(SCOPE, ORG, 't1', { title: 'Original', status: 'TODO' });
    expect(await ops()).toEqual([]);
  });

  it('merges automatically when the server changed other fields', async () => {
    await synced('t1', { title: 'Original' });
    await engine.update(SCOPE, ORG, 't1', { title: 'Meu título' });
    server.remoteEdit('t1', { status: 'IN_PROGRESS' });
    expect(await engine.push()).toBe('done');
    expect(server.tasks.get('t1')).toMatchObject({ title: 'Meu título', status: 'IN_PROGRESS', version: 3 });
    expect(await view('t1')).toMatchObject({ sync: 'synced', version: 3 });
    expect(await ops()).toEqual([]);
  });

  it('drops a change the server already has', async () => {
    await synced('t1');
    await engine.update(SCOPE, ORG, 't1', { status: 'DONE' });
    server.remoteEdit('t1', { status: 'DONE' });
    await engine.push();
    expect(await ops()).toEqual([]);
    expect(server.tasks.get('t1')!.version).toBe(2);
  });

  it('turns the same field changed on both sides into a conflict the user resolves', async () => {
    await synced('t1', { title: 'Original' });
    await engine.update(SCOPE, ORG, 't1', { title: 'Meu título', status: 'DONE' });
    server.remoteEdit('t1', { title: 'Título do colega' });
    await engine.push();

    const [op] = await ops();
    expect(op).toMatchObject({ state: 'conflict', baseVersion: 2, conflict: { reason: 'modified' } });
    expect(op.conflict!.fields).toEqual([{ field: 'title', local: 'Meu título', server: 'Título do colega' }]);
    expect(server.tasks.get('t1')!.title).toBe('Título do colega');
    expect(await view('t1')).toMatchObject({ sync: 'conflict', title: 'Meu título' });
    await expect(engine.update(SCOPE, ORG, 't1', { title: 'Outro' })).rejects.toBeInstanceOf(TaskLockedError);

    // "Usar os do servidor": o campo em conflito fica com o servidor; o restante é enviado.
    await engine.resolve(op.seq!, 'discard');
    await engine.push();
    expect(server.tasks.get('t1')).toMatchObject({ title: 'Título do colega', status: 'DONE' });
    expect(await ops()).toEqual([]);
  });

  it('applies local values over the current server version when the user keeps them', async () => {
    await synced('t1', { title: 'Original' });
    await engine.update(SCOPE, ORG, 't1', { title: 'Meu título' });
    server.remoteEdit('t1', { title: 'Título do colega' });
    await engine.push();
    await engine.resolve((await ops())[0].seq!, 'keep-mine');
    expect(await engine.push()).toBe('done');
    expect(server.tasks.get('t1')).toMatchObject({ title: 'Meu título', version: 3 });
  });

  it('asks before deleting a task that changed on the server', async () => {
    await synced('t1');
    await engine.remove(SCOPE, ORG, 't1');
    expect(await view('t1')).toBeUndefined();
    server.remoteEdit('t1', { title: 'Alterada depois' });
    await engine.push();
    const [op] = await ops();
    expect(op).toMatchObject({ kind: 'delete', state: 'conflict', baseVersion: 2 });
    expect(await view('t1')).toMatchObject({ sync: 'conflict', deleting: true, title: 'Alterada depois' });

    await engine.resolve(op.seq!, 'discard');
    expect(await ops()).toEqual([]);
    expect(server.tasks.has('t1')).toBe(true);

    await engine.remove(SCOPE, ORG, 't1');
    server.remoteEdit('t1', { status: 'DONE' });
    await engine.push();
    await engine.resolve((await ops())[0].seq!, 'keep-mine');
    await engine.push();
    expect(server.tasks.has('t1')).toBe(false);
    expect(await view('t1')).toBeUndefined();
  });

  it('treats deleting an already deleted task as done', async () => {
    await synced('t1');
    await engine.remove(SCOPE, ORG, 't1');
    server.tasks.delete('t1');
    expect(await engine.push()).toBe('done');
    expect(await ops()).toEqual([]);
  });

  it('offers to recreate a task edited here but deleted on the server', async () => {
    await synced('t1', { title: 'Original', status: 'TODO' });
    await engine.update(SCOPE, ORG, 't1', { status: 'DONE' });
    server.tasks.delete('t1');
    await engine.push();
    const [op] = await ops();
    expect(op).toMatchObject({ state: 'conflict', conflict: { reason: 'deleted' } });
    expect(await view('t1')).toMatchObject({ sync: 'conflict', status: 'DONE' });

    await engine.resolve(op.seq!, 'keep-mine');
    await engine.push();
    expect(server.tasks.get('t1')).toMatchObject({ title: 'Original', status: 'DONE', version: 1 });
  });

  it('marks refused operations as failed, holds later edits of that task and continues with others', async () => {
    const refused = await engine.create(SCOPE, ORG, fields({ title: 'Acima do limite' }));
    await engine.update(SCOPE, ORG, refused, { title: 'Ainda acima' });
    await synced('t2');
    server.failNext('create', 403, { code: 'PLAN_LIMIT_REACHED', message: 'O plano Gratuito permite até 2000 tarefas por organização.' });
    await engine.update(SCOPE, ORG, 't2', { status: 'DONE' });
    // A edição seguinte da tarefa recusada chega depois do envio começar: fica em outra operação.
    expect(await engine.push()).toBe('done');

    const [failed] = await engine.issues();
    expect(failed).toMatchObject({ kind: 'create', state: 'failed', error: 'O plano Gratuito permite até 2000 tarefas por organização.' });
    expect(server.tasks.get('t2')!.status).toBe('DONE');
    expect(await view(refused)).toMatchObject({ sync: 'failed' });

    await engine.resolve(failed.seq!, 'keep-mine');
    await engine.push();
    expect(server.tasks.get(refused)).toMatchObject({ title: 'Ainda acima' });

    const doomed = await engine.create(SCOPE, ORG, fields({ title: 'Recusada' }));
    server.failNext('create', 400, { message: ['title must be longer than or equal to 3 characters'] });
    await engine.push();
    const [issue] = await engine.issues();
    expect(issue.error).toBe('Dados inválidos: title must be longer than or equal to 3 characters');
    await engine.resolve(issue.seq!, 'discard');
    expect(await view(doomed)).toBeUndefined();
    expect(await ops()).toEqual([]);
  });

  it('stops on an expired session and keeps the queue', async () => {
    await synced('t1');
    await engine.update(SCOPE, ORG, 't1', { title: 'Depois do login' });
    server.failNext('update', 401);
    expect(await engine.push()).toBe('auth');
    expect(await ops()).toMatchObject([{ state: 'pending', attempts: 0 }]);
    expect(await engine.push()).toBe('done');
    expect(server.tasks.get('t1')!.title).toBe('Depois do login');
  });

  it('rebases edits made while the previous operation of the same task is in flight', async () => {
    const id = await engine.create(SCOPE, ORG, fields({ title: 'Criando' }));
    let editDuringCreate: Promise<void> | null = null;
    server.beforeCall = async (method) => {
      if (method === 'create' && !editDuringCreate) {
        editDuringCreate = engine.update(SCOPE, ORG, id, { title: 'Editada durante o envio' });
        await editDuringCreate;
      }
    };
    expect(await engine.push()).toBe('done');
    await editDuringCreate;
    expect(server.calls).toEqual(['create', 'update']);
    expect(server.tasks.get(id)).toMatchObject({ title: 'Editada durante o envio', version: 2 });
    expect(await ops()).toEqual([]);
  });

  it('keeps the newest tasks plus those with queued changes when pulling', async () => {
    for (let index = 0; index < OFFLINE_TASK_LIMIT + 5; index++) server.seed(`t${index}`);
    await engine.pull(SCOPE, ORG);
    expect(await store.getTasks(SCOPE)).toHaveLength(OFFLINE_TASK_LIMIT);
    expect(await store.getTask(SCOPE, 't0')).toBeUndefined(); // a mais antiga ficou de fora

    await engine.update(SCOPE, ORG, 't10', { title: 'Editada' });
    server.tasks.clear();
    server.seed('novo');
    await engine.pull(SCOPE, ORG);
    expect((await store.getTasks(SCOPE)).map((task) => task.id).sort()).toEqual(['novo', 't10']);
  });

  it('keeps data of each scope apart', async () => {
    await synced('t1');
    const otherScope = 'user-1:org-2';
    await engine.create(otherScope, 'org-2', fields({ title: 'Outra organização' }));
    expect((await engine.view(SCOPE)).map((task) => task.id)).toEqual(['t1']);
    expect((await engine.view(otherScope)).map((task) => task.title)).toEqual(['Outra organização']);
    expect(await engine.pendingCount(SCOPE)).toBe(0);
    expect(await engine.pendingCount()).toBe(1);
  });
});
