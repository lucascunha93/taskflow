import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Provider } from '@angular/core';
import * as Sentry from '@sentry/angular';

/**
 * Captura de erros do frontend (GlitchTip ou Sentry). Sem DSN, nada é enviado
 * e o tratamento padrão do Angular continua. Respostas HTTP esperadas (4xx) e
 * falhas de rede não são erros do app e não são reportadas.
 */

const PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [removido]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[jwt removido]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail removido]'],
  [/\b[\w-]{32,}\b/g, '[token removido]'],
];

export function scrubText(value: string): string {
  return PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/** Mantém o caminho e descarta query e fragmento (o link de redefinição traz o token após #). */
export function scrubUrl(value: string): string {
  const index = value.search(/[?#]/);
  return scrubText(index < 0 ? value : value.slice(0, index));
}

/** Erros que não indicam defeito do app: respostas 4xx da API e falta de conexão. */
export function isExpectedError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || (error.status >= 400 && error.status < 500));
}

export function scrubEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent | null {
  if (isExpectedError(hint?.originalException)) return null;
  if (event.request) {
    event.request = { url: event.request.url ? scrubUrl(event.request.url) : undefined, headers: {} };
  }
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  delete event.extra;
  if (event.sdkProcessingMetadata) delete event.sdkProcessingMetadata['normalizedRequest'];
  return event;
}

export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const result: Sentry.Breadcrumb = { ...breadcrumb };
  if (result.message) result.message = scrubText(result.message);
  if (result.data) {
    result.data = Object.fromEntries(Object.entries(result.data).map(([key, value]) => [
      key,
      typeof value !== 'string' ? value : key === 'url' || key === 'from' || key === 'to' ? scrubUrl(value) : scrubText(value),
    ]));
  }
  return result;
}

export interface ErrorReportingConfig {
  sentryDsn: string;
  sentryEnvironment: string;
}

/** Inicializa a captura antes do bootstrap; retorna se ficou ativa. */
export function initErrorReporting(config: ErrorReportingConfig): boolean {
  if (!config.sentryDsn) return false;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return true;
}

/** Substitui o ErrorHandler do Angular somente quando a captura está ativa. */
export function provideErrorReporting(enabled: boolean): Provider[] {
  return enabled ? [{ provide: ErrorHandler, useValue: Sentry.createErrorHandler() }] : [];
}
