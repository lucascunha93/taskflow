import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { OutboxOp } from './outbox.models';
import { ServerTask } from './task.models';

/**
 * Persistência local do app: cópia das tarefas do servidor, fila de operações
 * (outbox) e metadados (listas de membros, projetos, organizações, última
 * sincronização). Tudo é separado por escopo `${userId}:${organizationId}`.
 */
export interface LocalStore {
  getTasks(scope: string): Promise<ServerTask[]>;
  getTask(scope: string, id: string): Promise<ServerTask | undefined>;
  putTask(scope: string, task: ServerTask): Promise<void>;
  deleteTask(scope: string, id: string): Promise<void>;
  /** Substitui as tarefas do escopo, preservando as de `keepIds` ausentes em `tasks`. */
  replaceTasks(scope: string, tasks: ServerTask[], keepIds: ReadonlySet<string>): Promise<void>;
  /** Operações em ordem de criação; sem escopo, de todos os escopos. */
  getOps(scope?: string): Promise<OutboxOp[]>;
  addOp(op: OutboxOp): Promise<number>;
  putOp(op: OutboxOp): Promise<void>;
  deleteOp(seq: number): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

interface StoredTask extends ServerTask {
  scope: string;
}

interface OfflineSchema extends DBSchema {
  tasks: { key: [string, string]; value: StoredTask; indexes: { scope: string } };
  outbox: { key: number; value: OutboxOp; indexes: { scope: string } };
  meta: { key: string; value: { key: string; value: unknown } };
}

const strip = (row: StoredTask): ServerTask => {
  const task: Partial<StoredTask> = { ...row };
  delete task.scope;
  return task as ServerTask;
};

/** Implementação em IndexedDB, disponível no WebView do Capacitor e no navegador. */
export class IndexedDbStore implements LocalStore {
  private db: Promise<IDBPDatabase<OfflineSchema>> | null = null;

  constructor(private readonly name = 'taskflow-offline') {}

  private open(): Promise<IDBPDatabase<OfflineSchema>> {
    this.db ??= openDB<OfflineSchema>(this.name, 1, {
      upgrade(db) {
        const tasks = db.createObjectStore('tasks', { keyPath: ['scope', 'id'] });
        tasks.createIndex('scope', 'scope');
        const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        outbox.createIndex('scope', 'scope');
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    return this.db;
  }

  async getTasks(scope: string): Promise<ServerTask[]> {
    const rows = await (await this.open()).getAllFromIndex('tasks', 'scope', scope);
    return rows.map(strip);
  }

  async getTask(scope: string, id: string): Promise<ServerTask | undefined> {
    const row = await (await this.open()).get('tasks', [scope, id]);
    return row ? strip(row) : undefined;
  }

  async putTask(scope: string, task: ServerTask): Promise<void> {
    await (await this.open()).put('tasks', { ...task, scope });
  }

  async deleteTask(scope: string, id: string): Promise<void> {
    await (await this.open()).delete('tasks', [scope, id]);
  }

  async replaceTasks(scope: string, tasks: ServerTask[], keepIds: ReadonlySet<string>): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('tasks', 'readwrite');
    const incoming = new Set(tasks.map((task) => task.id));
    const existing = await tx.store.index('scope').getAllKeys(scope);
    for (const key of existing) {
      if (!incoming.has(key[1]) && !keepIds.has(key[1])) await tx.store.delete(key);
    }
    for (const task of tasks) await tx.store.put({ ...task, scope });
    await tx.done;
  }

  async getOps(scope?: string): Promise<OutboxOp[]> {
    const db = await this.open();
    return scope === undefined ? db.getAll('outbox') : db.getAllFromIndex('outbox', 'scope', scope);
  }

  async addOp(op: OutboxOp): Promise<number> {
    const value = { ...op };
    delete value.seq;
    return (await this.open()).add('outbox', value);
  }

  async putOp(op: OutboxOp): Promise<void> {
    await (await this.open()).put('outbox', op);
  }

  async deleteOp(seq: number): Promise<void> {
    await (await this.open()).delete('outbox', seq);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await (await this.open()).get('meta', key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await (await this.open()).put('meta', { key, value });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['tasks', 'outbox', 'meta'], 'readwrite');
    await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('outbox').clear(), tx.objectStore('meta').clear()]);
    await tx.done;
  }
}

/** Implementação em memória, usada nos testes. */
export class MemoryStore implements LocalStore {
  private readonly tasks = new Map<string, ServerTask>();
  private readonly ops = new Map<number, OutboxOp>();
  private readonly meta = new Map<string, unknown>();
  private nextSeq = 1;

  private key = (scope: string, id: string) => `${scope}\u0000${id}`;
  private clone = <T>(value: T): T => structuredClone(value);

  async getTasks(scope: string): Promise<ServerTask[]> {
    return [...this.tasks.entries()].filter(([key]) => key.startsWith(`${scope}\u0000`)).map(([, task]) => this.clone(task));
  }

  async getTask(scope: string, id: string): Promise<ServerTask | undefined> {
    const task = this.tasks.get(this.key(scope, id));
    return task ? this.clone(task) : undefined;
  }

  async putTask(scope: string, task: ServerTask): Promise<void> {
    this.tasks.set(this.key(scope, task.id), this.clone(task));
  }

  async deleteTask(scope: string, id: string): Promise<void> {
    this.tasks.delete(this.key(scope, id));
  }

  async replaceTasks(scope: string, tasks: ServerTask[], keepIds: ReadonlySet<string>): Promise<void> {
    const incoming = new Set(tasks.map((task) => task.id));
    for (const task of await this.getTasks(scope)) {
      if (!incoming.has(task.id) && !keepIds.has(task.id)) this.tasks.delete(this.key(scope, task.id));
    }
    for (const task of tasks) await this.putTask(scope, task);
  }

  async getOps(scope?: string): Promise<OutboxOp[]> {
    return [...this.ops.values()].filter((op) => scope === undefined || op.scope === scope)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((op) => this.clone(op));
  }

  async addOp(op: OutboxOp): Promise<number> {
    const seq = this.nextSeq++;
    this.ops.set(seq, this.clone({ ...op, seq }));
    return seq;
  }

  async putOp(op: OutboxOp): Promise<void> {
    if (op.seq === undefined) throw new Error('Operação sem seq.');
    this.ops.set(op.seq, this.clone(op));
  }

  async deleteOp(seq: number): Promise<void> {
    this.ops.delete(seq);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.has(key) ? this.clone(this.meta.get(key) as T) : undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, this.clone(value));
  }

  async clear(): Promise<void> {
    this.tasks.clear();
    this.ops.clear();
    this.meta.clear();
  }
}
