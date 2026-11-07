import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto.js';

const projectSelect = {
  id: true,
  organizationId: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { tasks: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

const toResponse = ({ _count, ...project }: ProjectRow) => ({ ...project, taskCount: _count.tasks });

/** Projetos de uma organização: membros consultam; OWNER e ADMIN gerenciam. */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, userId: string) {
    await this.role(organizationId, userId);
    const projects = await this.prisma.project.findMany({
      where: { organizationId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: projectSelect,
    });
    return projects.map(toResponse);
  }

  async findOne(organizationId: string, projectId: string, userId: string) {
    await this.role(organizationId, userId);
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId }, select: projectSelect });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    return toResponse(project);
  }

  async create(organizationId: string, userId: string, dto: CreateProjectDto) {
    await this.assertManager(organizationId, userId);
    try {
      const project = await this.prisma.project.create({
        data: { organizationId, name: dto.name.trim(), description: dto.description?.trim() || null },
        select: projectSelect,
      });
      return toResponse(project);
    } catch (error: unknown) {
      throw this.duplicate(error);
    }
  }

  async update(organizationId: string, projectId: string, userId: string, dto: UpdateProjectDto) {
    await this.assertManager(organizationId, userId);
    const description = dto.description === undefined ? undefined : dto.description?.trim() || null;
    try {
      const updated = await this.prisma.project.updateManyAndReturn({
        where: { id: projectId, organizationId },
        data: { name: dto.name?.trim(), description },
        select: { id: true },
      });
      if (updated.length === 0) throw new NotFoundException('Projeto não encontrado.');
    } catch (error: unknown) {
      throw this.duplicate(error);
    }
    return this.findOne(organizationId, projectId, userId);
  }

  /** Exclui o projeto; as tarefas permanecem na organização, sem projeto. */
  async remove(organizationId: string, projectId: string, userId: string): Promise<void> {
    await this.assertManager(organizationId, userId);
    const result = await this.prisma.project.deleteMany({ where: { id: projectId, organizationId } });
    if (result.count === 0) throw new NotFoundException('Projeto não encontrado.');
  }

  private async role(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Organização não encontrada.');
    return membership.role;
  }

  private async assertManager(organizationId: string, userId: string): Promise<void> {
    const role = await this.role(organizationId, userId);
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenException('Somente proprietários e administradores podem gerenciar projetos.');
    }
  }

  private duplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe um projeto com esse nome na organização.');
    }
    return error;
  }
}
