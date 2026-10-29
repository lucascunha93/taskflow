import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(userId: string, dto: CreateOrganizationDto) {
    const name = dto.name.trim();

    const baseSlug = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;

    return this.prisma.$transaction(async (tx) => {
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
}