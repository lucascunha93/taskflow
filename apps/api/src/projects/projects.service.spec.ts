import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from './projects.service.js';

describe('ProjectsService', () => {
  const organizationId = 'org';
  const userId = 'user';
  const row = { id: 'p1', organizationId, name: 'Site', description: null, createdAt: new Date(), updatedAt: new Date(), _count: { tasks: 3 } };
  let service: ProjectsService;
  let prisma: {
    membership: { findUnique: ReturnType<typeof vi.fn> };
    project: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateManyAndReturn: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN' }) },
      project: {
        findMany: vi.fn().mockResolvedValue([row]), findFirst: vi.fn().mockResolvedValue(row),
        create: vi.fn().mockResolvedValue(row), updateManyAndReturn: vi.fn().mockResolvedValue([{ id: 'p1' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [ProjectsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProjectsService);
  });

  it('lists projects of the organization with task counts for any member', async () => {
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const [project] = await service.list(organizationId, userId);
    expect(project).toMatchObject({ id: 'p1', name: 'Site', taskCount: 3 });
    expect(project).not.toHaveProperty('_count');
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId } }));
  });

  it('returns 404 outside the organization and 403 for members trying to manage', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(service.list(organizationId, userId)).rejects.toMatchObject({ status: 404 });
    prisma.membership.findUnique.mockResolvedValue({ role: 'MEMBER' });
    await expect(service.create(organizationId, userId, { name: 'Novo' })).rejects.toMatchObject({ status: 403 });
    await expect(service.update(organizationId, 'p1', userId, { name: 'X' })).rejects.toMatchObject({ status: 403 });
    await expect(service.remove(organizationId, 'p1', userId)).rejects.toMatchObject({ status: 403 });
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.deleteMany).not.toHaveBeenCalled();
  });

  it('creates with trimmed fields and reports duplicate names as 409', async () => {
    await service.create(organizationId, userId, { name: ' Site ', description: '  ' });
    expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { organizationId, name: 'Site', description: null },
    }));
    prisma.project.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.create(organizationId, userId, { name: 'Site' })).rejects.toMatchObject({ status: 409 });
  });

  it('updates and deletes only within the organization', async () => {
    await service.update(organizationId, 'p1', userId, { description: null });
    expect(prisma.project.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1', organizationId }, data: { name: undefined, description: null },
    }));
    prisma.project.updateManyAndReturn.mockResolvedValueOnce([]);
    await expect(service.update(organizationId, 'foreign', userId, { name: 'X' })).rejects.toMatchObject({ status: 404 });
    prisma.project.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(organizationId, 'foreign', userId)).rejects.toMatchObject({ status: 404 });
    expect(prisma.project.deleteMany).toHaveBeenLastCalledWith({ where: { id: 'foreign', organizationId } });
  });
});
