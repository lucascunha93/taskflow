import { ForbiddenException } from '@nestjs/common';
import type { OrganizationPlan } from '../generated/prisma/client.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Limites de um plano; `null` significa sem limite numérico. */
export interface PlanLimits {
  members: number | null;
  projects: number | null;
  tasks: number | null;
  storageBytes: number;
  maxFileBytes: number;
}

export interface PlanDefinition {
  id: OrganizationPlan;
  name: string;
  limits: PlanLimits;
}

/**
 * Catálogo de planos. O armazenamento de arquivos é o principal custo variável,
 * por isso todos os planos têm cota de armazenamento e de tamanho por arquivo;
 * membros, projetos e tarefas limitam o uso do plano gratuito.
 */
export const PLANS: Record<OrganizationPlan, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Gratuito',
    limits: { members: 5, projects: 3, tasks: 2000, storageBytes: 1 * GB, maxFileBytes: 10 * MB },
  },
  PRO: {
    id: 'PRO',
    name: 'Profissional',
    limits: { members: 50, projects: null, tasks: null, storageBytes: 20 * GB, maxFileBytes: 25 * MB },
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Empresarial',
    limits: { members: 250, projects: null, tasks: null, storageBytes: 200 * GB, maxFileBytes: 25 * MB },
  },
};

/** Maior tamanho de arquivo entre os planos: limite absoluto do upload (acima, 413). */
export const MAX_FILE_BYTES = Math.max(...Object.values(PLANS).map((plan) => plan.limits.maxFileBytes));

/** Organizações no plano gratuito das quais um mesmo usuário pode ser proprietário. */
export const FREE_ORGANIZATIONS_PER_OWNER = 3;

export type LimitedResource = 'members' | 'projects' | 'tasks' | 'storage' | 'fileSize' | 'freeOrganizations';

/**
 * Limite do plano atingido: 403 com `code: "PLAN_LIMIT_REACHED"`, o recurso
 * (`limit`) e o plano, para que os clientes diferenciem de falta de permissão.
 */
export class PlanLimitException extends ForbiddenException {
  constructor(limit: LimitedResource, plan: OrganizationPlan, message: string) {
    super({ statusCode: 403, error: 'Forbidden', code: 'PLAN_LIMIT_REACHED', limit, plan, message });
  }
}

export function formatBytes(bytes: number): string {
  return bytes >= GB ? `${bytes / GB} GB` : `${bytes / MB} MB`;
}
