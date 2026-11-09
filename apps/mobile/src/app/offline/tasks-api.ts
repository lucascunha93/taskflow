import { ServerTask, TaskFields } from './task.models';

/** Erro HTTP da API. `status` 0 indica falha de rede (sem resposta). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown = null) {
    super(`HTTP ${status}`);
  }

  /** Falhas que se resolvem sozinhas: sem conexão, tempo esgotado, limite de requisições ou erro do servidor. */
  get transient(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }

  /** Mensagem da API, quando houver. */
  get apiMessage(): string | null {
    const message = (this.body as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    return null;
  }
}

export interface TaskPage {
  data: ServerTask[];
  totalPages: number;
}

/** Operações de tarefas usadas pela sincronização. Erros são lançados como `ApiError`. */
export interface TasksApi {
  list(organizationId: string, page: number, limit: number): Promise<TaskPage>;
  get(organizationId: string, taskId: string): Promise<ServerTask>;
  create(organizationId: string, body: TaskFields & { id: string }): Promise<ServerTask>;
  update(organizationId: string, taskId: string, body: Partial<TaskFields> & { version: number }): Promise<ServerTask>;
  remove(organizationId: string, taskId: string, version: number): Promise<void>;
}
