import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlansService } from '../plans/plans.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  AddMemberDto,
  OrganizationMemberRole,
} from './dto/add-member.dto.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';

const MANAGER_ROLES = ['OWNER', 'ADMIN'] as const;


@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) { }

  async create(userId: string, dto: CreateOrganizationDto) {
    const name = dto.name.trim();

    const baseSlug = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 71)
      .replace(/-+$/g, '');

    const slug = `${baseSlug || 'organization'}-${crypto.randomUUID().slice(0, 8)}`;

    return this.prisma.$transaction(async (tx) => {
      // Toda organização nasce no plano gratuito.
      await this.plans.assertCanOwnFreeOrganization(tx, userId);
      const organization = await tx.organization.create({
        data: {
          name,
          slug,
        },
      });

      await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId,
          role: 'OWNER',
        },
      });

      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
        role: 'OWNER' as const,
        createdAt: organization.createdAt,
      };
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.organization.findMany({
      where: {
        memberships: {
          some: {
            userId,
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        createdAt: true,
        memberships: {
          where: {
            userId,
          },
          select: {
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Renomeia a organização. Somente OWNER e ADMIN podem alterar o nome;
   * o slug é um identificador estável e não muda.
   */
  async update(
    organizationId: string,
    requesterId: string,
    dto: UpdateOrganizationDto,
  ) {
    const requesterMembership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: requesterId,
        },
      },
      select: { role: true },
    });

    if (!requesterMembership) {
      throw new NotFoundException('Organização não encontrada.');
    }

    if (requesterMembership.role !== 'OWNER' && requesterMembership.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Você não tem permissão para alterar a organização.',
      );
    }

    try {
      // A condição de associação é repetida na própria atualização para que
      // a autorização e a alteração ocorram em uma única operação.
      const organization = await this.prisma.organization.update({
        where: {
          id: organizationId,
          memberships: {
            some: { userId: requesterId, role: { in: [...MANAGER_ROLES] } },
          },
        },
        data: { name: dto.name.trim() },
        select: { id: true, name: true, slug: true, plan: true, createdAt: true },
      });

      return { ...organization, role: requesterMembership.role };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Organização não encontrada.');
      }
      throw error;
    }
  }

  async addMember(
    organizationId: string,
    requesterId: string,
    dto: AddMemberDto,
  ) {
    const email = dto.email.trim().toLowerCase();

    // Verifica se a organização existe e se quem solicita
    // é OWNER ou ADMIN dessa organização.
    const requesterMembership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: requesterId,
        },
      },
      select: {
        role: true,
      },
    });

    if (!requesterMembership) {
      throw new NotFoundException('Organização não encontrada.');
    }

    if (
      requesterMembership.role !== 'OWNER' &&
      requesterMembership.role !== 'ADMIN'
    ) {
      throw new ForbiddenException(
        'Você não tem permissão para adicionar membros.',
      );
    }

    // Localiza o usuário que será adicionado.
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        'Não existe usuário cadastrado com esse e-mail.',
      );
    }

    // Evita associar o mesmo usuário duas vezes.
    const existingMembership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.id,
        },
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        'Esse usuário já pertence à organização.',
      );
    }

    // Um ADMIN não pode adicionar outro ADMIN.
    if (
      requesterMembership.role === 'ADMIN' &&
      dto.role === OrganizationMemberRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Somente o OWNER pode adicionar administradores.',
      );
    }

    let membership;
    try {
      membership = await this.prisma.$transaction(async (tx) => {
        await this.plans.assertCanCreate(tx, organizationId, 'members');
        return tx.membership.create({
          data: {
            organizationId,
            userId: user.id,
            role: dto.role,
          },
          select: {
            id: true,
            role: true,
            createdAt: true,
          },
        });
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Esse usuário já pertence à organização.');
      }
      throw error;
    }

    return {
      user,
      membership,
    };
  }


  async findMembers(
    organizationId: string,
    requesterId: string,
  ) {
    const requesterMembership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: requesterId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!requesterMembership) {
      throw new NotFoundException('Organização não encontrada.');
    }

    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships;
  }
}