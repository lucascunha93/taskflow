export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
  author: { id: string; name: string };
}

export interface TaskCommentPage {
  data: TaskComment[];
  nextCursor: string | null;
}

export const COMMENT_MAX_LENGTH = 5000;

export function commentFromResponse(value: unknown, taskId: string): TaskComment {
  if (typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' || !value.id ||
    !('taskId' in value) || value.taskId !== taskId ||
    !('body' in value) || typeof value.body !== 'string' ||
    !('createdAt' in value) || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) ||
    !('editedAt' in value) || (value.editedAt !== null && typeof value.editedAt !== 'string') ||
    !('author' in value) || typeof value.author !== 'object' || value.author === null ||
    !('id' in value.author) || typeof value.author.id !== 'string' ||
    !('name' in value.author) || typeof value.author.name !== 'string') {
    throw new Error('Resposta de comentário inválida.');
  }
  return {
    id: value.id, taskId, body: value.body, createdAt: value.createdAt, editedAt: value.editedAt,
    author: { id: value.author.id, name: value.author.name },
  };
}
