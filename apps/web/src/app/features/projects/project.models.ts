export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  description: string | null;
}

export function projectFromResponse(value: unknown, organizationId: string): Project {
  if (typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' || !value.id ||
    !('organizationId' in value) || value.organizationId !== organizationId ||
    !('name' in value) || typeof value.name !== 'string' || !value.name ||
    !('description' in value) || (value.description !== null && typeof value.description !== 'string') ||
    !('taskCount' in value) || !Number.isInteger(value.taskCount) || (value.taskCount as number) < 0 ||
    !('createdAt' in value) || typeof value.createdAt !== 'string' ||
    !('updatedAt' in value) || typeof value.updatedAt !== 'string') {
    throw new Error('Resposta de projeto inválida.');
  }
  return {
    id: value.id, organizationId, name: value.name, description: value.description,
    taskCount: value.taskCount as number, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}
