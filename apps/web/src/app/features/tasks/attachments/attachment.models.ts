export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
  uploader: { id: string; name: string };
}

/**
 * Espelha a política da API; a validação definitiva acontece no servidor.
 * 25 MB é o maior limite entre os planos; o limite do plano (10 MB no Gratuito)
 * é verificado pela API, que responde com a mensagem do plano.
 */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'csv', 'zip',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'doc', 'xls', 'ppt',
] as const;

export function attachmentFromResponse(value: unknown, taskId: string): TaskAttachment {
  if (typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' || !value.id ||
    !('taskId' in value) || value.taskId !== taskId ||
    !('fileName' in value) || typeof value.fileName !== 'string' || !value.fileName ||
    !('contentType' in value) || typeof value.contentType !== 'string' ||
    !('size' in value) || !Number.isInteger(value.size) || (value.size as number) < 0 ||
    !('createdAt' in value) || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) ||
    !('uploader' in value) || typeof value.uploader !== 'object' || value.uploader === null ||
    !('id' in value.uploader) || typeof value.uploader.id !== 'string' ||
    !('name' in value.uploader) || typeof value.uploader.name !== 'string') {
    throw new Error('Resposta de anexo inválida.');
  }
  return {
    id: value.id, taskId, fileName: value.fileName, contentType: value.contentType, size: value.size as number,
    createdAt: value.createdAt, uploader: { id: value.uploader.id, name: value.uploader.name },
  };
}

/** Mensagem de erro de validação local, ou `null` se o arquivo pode ser enviado. */
export function localFileProblem(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Tipo de arquivo não permitido. Use: ${ATTACHMENT_EXTENSIONS.join(', ')}.`;
  }
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'O arquivo excede o limite de 25 MB.';
  return null;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${(size / (1024 * 1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
}
