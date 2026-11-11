import type { ErrorEvent } from '@sentry/nestjs';
import { validateEnvironment } from '../config/environment.js';
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './scrub.js';
import { sentryOptions } from './sentry-options.js';

describe('error reporting privacy', () => {
  it('removes e-mails, JWTs, bearer credentials and long tokens from text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';
    expect(scrubText(`falha para ana.silva@example.test com ${jwt}`)).toBe('falha para [e-mail removido] com [jwt removido]');
    expect(scrubText('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [removido]');
    expect(scrubText('token Zk3x9QmLp2Rt8VwY5Nc7Hb4Jd6Fg1Ks0Ae-_uiop')).toBe('token [token removido]');
    expect(scrubText('Tarefa 42 não encontrada')).toBe('Tarefa 42 não encontrada');
  });

  it('keeps URL paths but drops query strings and fragments', () => {
    expect(scrubUrl('/auth/password/reset?token=abc#x')).toBe('/auth/password/reset');
    expect(scrubUrl('/organizations/11111111-1111-4111-8111-111111111111/tasks')).toContain('/organizations/');
  });

  it('drops request bodies, cookies, sensitive headers, extra data and user details', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'Erro com bia@example.test',
      request: {
        method: 'POST', url: 'http://api/auth/login?next=/x', data: '{"password":"segredo"}', cookies: { taskflow_refresh: 'r' },
        headers: { authorization: 'Bearer x', cookie: 'a=b', 'user-agent': 'vitest', 'x-taskflow-request': '1' },
        query_string: 'next=/x',
      },
      user: { id: 'u1', email: 'bia@example.test', ip_address: '10.0.0.1' },
      exception: { values: [{ type: 'Error', value: 'Falha ao enviar para bia@example.test' }] },
      breadcrumbs: [{ category: 'http', data: { url: 'http://s3/obj?X-Amz-Signature=abc', status_code: 500 } }],
      extra: { body: 'segredo' },
    } as ErrorEvent);
    expect(event.request).toEqual({ method: 'POST', url: 'http://api/auth/login', headers: { 'user-agent': 'vitest' } });
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.message).toBe('Erro com [e-mail removido]');
    expect(event.exception?.values?.[0].value).toBe('Falha ao enviar para [e-mail removido]');
    expect(event.breadcrumbs?.[0].data).toEqual({ url: 'http://s3/obj', status_code: 500 });
    expect(event.extra).toBeUndefined();
    expect(scrubBreadcrumb({ message: 'login de ana@example.test' })?.message).toBe('login de [e-mail removido]');
  });

  it('is disabled without a DSN and never collects personal data', () => {
    expect(sentryOptions({})).toBeNull();
    const options = sentryOptions({ SENTRY_DSN: 'http://key@localhost:8010/1', NODE_ENV: 'test' });
    expect(options).toMatchObject({
      environment: 'test', tracesSampleRate: 0,
      dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
    });
  });

  it('validates the DSN format', () => {
    const base = { JWT_SECRET: 'test-only-secret-at-least-32-characters' };
    expect(() => validateEnvironment({ ...base, SENTRY_DSN: 'http://abc123@localhost:8010/1' })).not.toThrow();
    expect(() => validateEnvironment({ ...base, SENTRY_DSN: 'localhost:8010' })).toThrow(/SENTRY_DSN/);
  });
});
