import { UnsupportedMediaTypeException } from '@nestjs/common';

/** Limite absoluto do envio (o maior entre os planos); o limite do plano é verificado no serviço. */
export { MAX_FILE_BYTES as ATTACHMENT_MAX_BYTES } from '../../plans/plan-limits.js';
export const ATTACHMENTS_PER_TASK = 20;

type Signature = (bytes: Buffer) => boolean;

const startsWith = (...prefix: number[]): Signature => (bytes) =>
  bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
const zip: Signature = (bytes) => startsWith(0x50, 0x4b, 0x03, 0x04)(bytes) || startsWith(0x50, 0x4b, 0x05, 0x06)(bytes);
const ole: Signature = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const webp: Signature = (bytes) => startsWith(0x52, 0x49, 0x46, 0x46)(bytes) && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
/** Texto UTF-8 válido, sem bytes nulos (evita binários renomeados para .txt). */
const text: Signature = (bytes) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/**
 * Tipos aceitos, pela extensão. O tipo informado pelo navegador é ignorado: o
 * conteúdo precisa ter a assinatura esperada e é servido com o tipo daqui.
 * HTML, SVG, scripts e executáveis não são aceitos.
 */
const POLICY: Readonly<Record<string, { contentType: string; signature: Signature }>> = {
  png: { contentType: 'image/png', signature: startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  jpg: { contentType: 'image/jpeg', signature: startsWith(0xff, 0xd8, 0xff) },
  jpeg: { contentType: 'image/jpeg', signature: startsWith(0xff, 0xd8, 0xff) },
  gif: { contentType: 'image/gif', signature: (bytes) => bytes.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/) !== null },
  webp: { contentType: 'image/webp', signature: webp },
  pdf: { contentType: 'application/pdf', signature: startsWith(0x25, 0x50, 0x44, 0x46, 0x2d) },
  txt: { contentType: 'text/plain; charset=utf-8', signature: text },
  md: { contentType: 'text/markdown; charset=utf-8', signature: text },
  csv: { contentType: 'text/csv; charset=utf-8', signature: text },
  zip: { contentType: 'application/zip', signature: zip },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: zip },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: zip },
  pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', signature: zip },
  odt: { contentType: 'application/vnd.oasis.opendocument.text', signature: zip },
  ods: { contentType: 'application/vnd.oasis.opendocument.spreadsheet', signature: zip },
  odp: { contentType: 'application/vnd.oasis.opendocument.presentation', signature: zip },
  doc: { contentType: 'application/msword', signature: ole },
  xls: { contentType: 'application/vnd.ms-excel', signature: ole },
  ppt: { contentType: 'application/vnd.ms-powerpoint', signature: ole },
};

export const ALLOWED_EXTENSIONS = Object.keys(POLICY);

/** Remove caminho e caracteres de controle e limita o tamanho, preservando a extensão. */
export function sanitizeFileName(original: string): string {
  // Multer entrega o nome em latin1; decodifica como UTF-8 quando for válido.
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  const withoutPath = (decoded.includes('�') ? original : decoded).split(/[\\/]/).pop() ?? '';
  const name = Array.from(withoutPath)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  if (name.length <= 255) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  return name.slice(0, 255 - extension.length) + extension;
}

/** Valida o arquivo e retorna o tipo de conteúdo canônico. */
export function attachmentContentType(fileName: string, bytes: Buffer): string {
  const dot = fileName.lastIndexOf('.');
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  const rule = POLICY[extension];
  if (!rule) {
    throw new UnsupportedMediaTypeException(
      `Tipo de arquivo não permitido. Use: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    );
  }
  if (bytes.length === 0 || !rule.signature(bytes)) {
    throw new UnsupportedMediaTypeException('O conteúdo do arquivo não corresponde à extensão informada.');
  }
  return rule.contentType;
}
