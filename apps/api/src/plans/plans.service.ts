import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationPlan, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  FREE_ORGANIZATIONS_PER_OWNER,
  PLANS,
  PlanLimitException,
  formatBytes,
} from './plan-limits.js';

type Client = Prisma.TransactionClient | PrismaService;
type CountedResource = 'members' | 'projects' | 'tasks';

const RESOURCE_LABELS: Record<CountedResource, string> = {
  members: 'membros',
  projects: 'projetos',
  tasks: 'tarefas',
};

/**
 * Aplica os limites do plano da organização. As verificações que antecedem uma
 * criação travam a linha da organização (`FOR NO KEY UPDATE`) na transação da
 * escrita: criações concorrentes na mesma organização são serializadas e não
 * ultrapassam o limite. Essa trava não bloqueia as chaves estrangeiras que
 * apontam para a organização.
 *
 * Reduzir o plano nunca remove dados: o que já excede o novo limite permanece,
 * e apenas novas criações do recurso ficam bloqueadas.
 */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  catalog() {
    return Object.values(PLANS);
  }

  /** Plano, limites e uso atual. Qualquer membro consulta; não membros recebem 404. */
  async overview(organizationId: string, userId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, memberships: { some: { userId } } },
      select: { plan: true, planChangedAt: true },
    });
    if (!organization) throw new NotFoundException('Organização não encontrada.');
    const [members, projects, tasks, storage] = await this.prisma.$transaction([
      this.prisma.membership.count({ where: { organizationId } }),
      this.prisma.project.count({ where: { organizationId } }),
      this.prisma.task.count({ where: { organizationId } }),
      this.prisma.taskAttachment.aggregate({ where: { organizationId }, _sum: { size: true } }),
    ], { isolationLevel: 'RepeatableRead' });
    const plan = PLANS[organization.plan];
    return {
      plan: plan.id,
      name: plan.name,
      planChangedAt: organization.planChangedAt,
      limits: plan.limits,
      usage: { members, projects, tasks, storageBytes: Number(storage._sum.size ?? 0) },
    };
  }

  /** Trava a organização na transação e retorna o plano; 404 se não existir. */
  async lock(tx: Prisma.TransactionClient, organizationId: string): Promise<OrganizationPlan> {
    const rows = await tx.$queryRaw<{ plan: OrganizationPlan }[]>`
      SELECT plan FROM organizations WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Organização não encontrada.');
    return rows[0].plan;
  }

  /** Recusa a criação de mais um membro, projeto ou tarefa acima do limite do plano. */
  async assertCanCreate(tx: Prisma.TransactionClient, organizationId: string, resource: CountedResource): Promise<void> {
    const plan = await this.lock(tx, organizationId);
    const max = PLANS[plan].limits[resource];
    if (max === null) return;
    const used = await this.count(tx, organizationId, resource);
    if (used >= max) {
      throw new PlanLimitException(
        resource,
        plan,
        `O plano ${PLANS[plan].name} permite até ${max} ${RESOURCE_LABELS[resource]} por organização.`,
      );
    }
  }

  /**
   * Verifica tamanho do arquivo e cota de armazenamento. Sem `tx`, é a checagem
   * prévia ao envio; com `tx`, trava a organização e confirma a cota antes do registro.
   */
  async assertCanStore(organizationId: string, size: number, tx?: Prisma.TransactionClient): Promise<void> {
    const plan = tx ? await this.lock(tx, organizationId) : await this.planOf(organizationId);
    const { maxFileBytes, storageBytes } = PLANS[plan].limits;
    if (size > maxFileBytes) {
      throw new PlanLimitException(
        'fileSize',
        plan,
        `O plano ${PLANS[plan].name} aceita arquivos de até ${formatBytes(maxFileBytes)}.`,
      );
    }
    const used = await this.storageUsed(tx ?? this.prisma, organizationId);
    if (used + size > storageBytes) {
      throw new PlanLimitException(
        'storage',
        plan,
        `O armazenamento do plano ${PLANS[plan].name} (${formatBytes(storageBytes)}) está esgotado.`,
      );
    }
  }

  /**
   * Um usuário pode ser proprietário de poucas organizações gratuitas, para que
   * os limites não sejam contornados criando novas organizações. Trava o usuário
   * para serializar criações simultâneas.
   */
  async assertCanOwnFreeOrganization(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    const owned = await tx.membership.count({
      where: { userId, role: 'OWNER', organization: { plan: 'FREE' } },
    });
    if (owned >= FREE_ORGANIZATIONS_PER_OWNER) {
      throw new PlanLimitException(
        'freeOrganizations',
        'FREE',
        `Cada usuário pode ser proprietário de até ${FREE_ORGANIZATIONS_PER_OWNER} organizações no plano Gratuito.`,
      );
    }
  }

  private async planOf(organizationId: string): Promise<OrganizationPlan> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!organization) throw new NotFoundException('Organização não encontrada.');
    return organization.plan;
  }

  private count(client: Client, organizationId: string, resource: CountedResource): Promise<number> {
    if (resource === 'members') return client.membership.count({ where: { organizationId } });
    if (resource === 'projects') return client.project.count({ where: { organizationId } });
    return client.task.count({ where: { organizationId } });
  }

  private async storageUsed(client: Client, organizationId: string): Promise<number> {
    const result = await client.taskAttachment.aggregate({ where: { organizationId }, _sum: { size: true } });
    return Number(result._sum.size ?? 0);
  }
}
