import type { Breadcrumb, ErrorEvent } from '@sentry/nestjs';

/** Cabeçalhos que podem ir junto com um erro; todos os demais são descartados. */
export const SAFE_HEADER_NAMES = ['user-agent', 'content-type', 'accept', 'accept-language', 'content-length'];
const SAFE_HEADERS = new Set(SAFE_HEADER_NAMES);

const PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [removido]'],
  // JWT (três partes base64url).
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[jwt removido]'],
  // E-mails.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail removido]'],
  // Tokens opacos longos (refresh, redefinição de senha, URLs assinadas).
  [/\b[\w-]{32,}\b/g, '[token removido]'],
];

/** Remove e-mails, tokens e credenciais de um texto. */
export function scrubText(value: string): string {
  return PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/** Mantém o caminho da URL e descarta a query (pode conter tokens e filtros). */
export function scrubUrl(value: string): string {
  const index = value.search(/[?#]/);
  return scrubText(index < 0 ? value : value.slice(0, index));
}

/**
 * Prepara um erro para envio ao GlitchTip/Sentry sem dados pessoais nem
 * segredos: sem corpo da requisição, cookies, query string, cabeçalhos de
 * autenticação ou dados do usuário além do identificador.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const headers = Object.fromEntries(Object.entries(event.request.headers ?? {})
      .filter(([name]) => SAFE_HEADERS.has(name.toLowerCase())));
    event.request = {
      method: event.request.method,
      url: event.request.url ? scrubUrl(event.request.url) : undefined,
      headers,
    };
  }
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
    // Linhas de código ao redor do erro: úteis para depurar, mas limpas como qualquer texto.
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.context_line) frame.context_line = scrubText(frame.context_line);
      if (frame.pre_context) frame.pre_context = frame.pre_context.map(scrubText);
      if (frame.post_context) frame.post_context = frame.post_context.map(scrubText);
      delete frame.vars;
    }
  }
  // Cópia interna da requisição original (com query string) mantida pelo SDK.
  if (event.sdkProcessingMetadata) delete event.sdkProcessingMetadata['normalizedRequest'];
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((item): item is Breadcrumb => item !== null);
  delete event.extra;
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const result: Breadcrumb = { ...breadcrumb };
  if (result.message) result.message = scrubText(result.message);
  if (result.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result.data)) {
      if (typeof value !== 'string') data[key] = value;
      else data[key] = key === 'url' ? scrubUrl(value) : scrubText(value);
    }
    result.data = data;
  }
  return result;
}
