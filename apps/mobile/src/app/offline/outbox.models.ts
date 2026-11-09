import { ServerTask, TaskField, TaskFields } from './task.models';

/**
 * Operação local aguardando envio. As operações são enviadas na ordem em que
 * foram criadas (`seq`), uma por vez.
 *
 * - `pending`: aguardando envio (ou nova tentativa após falha de rede).
 * - `conflict`: o servidor mudou de forma incompatível; o usuário decide.
 * - `failed`: a API recusou (permissão, validação, limite do plano); o usuário
 *   pode tentar de novo ou descartar.
 *
 * Operações posteriores da mesma tarefa esperam a resolução de um conflito ou
 * falha; as de outras tarefas continuam sendo enviadas.
 */
export type OpState = 'pending' | 'conflict' | 'failed';

interface BaseOp {
  seq?: number;
  /** `${userId}:${organizationId}` — os dados de cada usuário e organização ficam separados. */
  scope: string;
  organizationId: string;
  taskId: string;
  createdAt: string;
  state: OpState;
  attempts: number;
  /** Momento a partir do qual uma operação com falha de rede pode ser reenviada. */
  retryAt?: string;
  error?: string;
  conflict?: OpConflict;
}

export interface CreateOp extends BaseOp {
  kind: 'create';
  fields: TaskFields;
}

/**
 * Atualização parcial. `baseVersion` é a versão do servidor sobre a qual a
 * alteração foi feita (0 quando a tarefa ainda está sendo criada pelo próprio
 * aparelho) e `base` guarda os valores de todos os campos nessa versão, para a
 * comparação em três vias quando o servidor responder 409.
 */
export interface UpdateOp extends BaseOp {
  kind: 'update';
  baseVersion: number;
  base: TaskFields;
  changes: Partial<TaskFields>;
}

export interface DeleteOp extends BaseOp {
  kind: 'delete';
  baseVersion: number;
}

export type OutboxOp = CreateOp | UpdateOp | DeleteOp;

export interface FieldConflict {
  field: TaskField;
  local: unknown;
  server: unknown;
}

export interface OpConflict {
  /** `modified`: alterada no servidor; `deleted`: excluída no servidor. */
  reason: 'modified' | 'deleted';
  fields: FieldConflict[];
  server: ServerTask | null;
}

/**
 * Escolha do usuário para uma operação em conflito ou com falha:
 * - `keep-mine`: reaplica a alteração local sobre a versão atual do servidor
 *   (atualização), exclui mesmo assim (exclusão), recria a tarefa excluída no
 *   servidor ou tenta de novo após uma falha.
 * - `discard`: descarta a alteração local em conflito e mantém o servidor.
 */
export type Resolution = 'keep-mine' | 'discard';
