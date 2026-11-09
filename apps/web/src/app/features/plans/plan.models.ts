import { HttpErrorResponse } from '@angular/common/http';

export type PlanId = 'FREE' | 'PRO' | 'BUSINESS';

export interface PlanLimits {
  members: number | null;
  projects: number | null;
  tasks: number | null;
  storageBytes: number;
  maxFileBytes: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  limits: PlanLimits;
}

export interface PlanOverview {
  plan: PlanId;
  name: string;
  planChangedAt: string | null;
  limits: PlanLimits;
  usage: { members: number; projects: number; tasks: number; storageBytes: number };
}

export const PLAN_NAMES: Readonly<Record<PlanId, string>> = {
  FREE: 'Gratuito',
  PRO: 'Profissional',
  BUSINESS: 'Empresarial',
};

/**
 * Mensagem para um limite de plano atingido (403 com `code: "PLAN_LIMIT_REACHED"`),
 * ou `null` para qualquer outro erro, que segue o tratamento da tela.
 */
export function planLimitMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) return null;
  const body = error.error as { code?: unknown; message?: unknown } | null;
  if (body?.code !== 'PLAN_LIMIT_REACHED') return null;
  const reason = typeof body.message === 'string' && body.message ? body.message : 'O limite do plano foi atingido.';
  return `${reason} Veja o uso em Plano e fale com o proprietário para mudar de plano.`;
}

/** Percentual de uso (0 a 100) ou `null` quando o recurso não tem limite numérico. */
export function usagePercent(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}
