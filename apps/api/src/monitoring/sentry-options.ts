import type { NodeOptions } from '@sentry/nestjs';
import { SAFE_HEADER_NAMES, scrubBreadcrumb, scrubEvent } from './scrub.js';

/**
 * Configuração da captura de erros (GlitchTip ou Sentry). Sem SENTRY_DSN, nada
 * é enviado. Só erros inesperados chegam: o filtro global ignora exceções HTTP
 * (400, 403, 404, 409...). Rastreamento de desempenho fica desligado.
 */
export function sentryOptions(env: Record<string, string | undefined>): NodeOptions | null {
  const dsn = env['SENTRY_DSN']?.trim();
  if (!dsn) return null;
  return {
    dsn,
    environment: env['SENTRY_ENVIRONMENT']?.trim() || env['NODE_ENV']?.trim() || 'development',
    release: env['SENTRY_RELEASE']?.trim() || undefined,
    // Nada de dados pessoais: sem usuário, cookies, corpos ou query; só cabeçalhos neutros.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: SAFE_HEADER_NAMES }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
