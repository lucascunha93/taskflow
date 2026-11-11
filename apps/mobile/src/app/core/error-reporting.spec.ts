import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler } from '@angular/core';
import type { ErrorEvent } from '@sentry/angular';
import { isExpectedError, provideErrorReporting, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './error-reporting';

describe('frontend error reporting', () => {
  it('ignores expected HTTP responses and offline failures but keeps server and code errors', () => {
    expect(isExpectedError(new HttpErrorResponse({ status: 404 }))).toBe(true);
    expect(isExpectedError(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(isExpectedError(new HttpErrorResponse({ status: 500 }))).toBe(false);
    expect(isExpectedError(new TypeError('x is undefined'))).toBe(false);
    expect(scrubEvent({ type: undefined } as ErrorEvent, { originalException: new HttpErrorResponse({ status: 409 }) })).toBeNull();
  });

  it('removes tokens from URLs, including the reset link fragment, and personal data from messages', () => {
    expect(scrubUrl('https://app.test/reset-password#token=abc')).toBe('https://app.test/reset-password');
    expect(scrubUrl('https://app.test/tasks?search=cliente')).toBe('https://app.test/tasks');
    expect(scrubText('Falha para ana@example.test')).toBe('Falha para [e-mail removido]');
    const event = scrubEvent({
      type: undefined,
      request: { url: 'https://app.test/plan?x=1', headers: { Referer: 'https://app.test/reset-password#token=abc' } },
      user: { id: 'u1', email: 'ana@example.test' },
      exception: { values: [{ type: 'Error', value: 'Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln inválido' }] },
      extra: { form: 'segredo' },
    } as ErrorEvent)!;
    expect(event.request).toEqual({ url: 'https://app.test/plan', headers: {} });
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.exception?.values?.[0].value).toBe('Token [jwt removido] inválido');
    expect(event.extra).toBeUndefined();
    expect(scrubBreadcrumb({ category: 'navigation', data: { from: '/login', to: '/reset-password#token=abc' } }).data)
      .toEqual({ from: '/login', to: '/reset-password' });
  });

  it('replaces the Angular error handler only when reporting is enabled', () => {
    expect(provideErrorReporting(false)).toEqual([]);
    expect(provideErrorReporting(true)).toEqual([expect.objectContaining({ provide: ErrorHandler })]);
  });
});
