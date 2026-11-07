import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { IssuedRefreshToken } from './refresh-tokens.service.js';

export const REFRESH_COOKIE = 'taskflow_refresh';
/**
 * Cabeçalho exigido nos endpoints que usam o cookie. Um formulário ou link de
 * outro site não consegue enviá-lo, e o CORS bloqueia scripts de origens não
 * autorizadas; complementa o `SameSite=Strict` do cookie.
 */
export const REFRESH_REQUEST_HEADER = 'x-taskflow-request';

export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === REFRESH_COOKIE) {
      const value = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@Injectable()
export class RefreshCookieService {
  constructor(private readonly config: ConfigService) {}

  set(response: Response, issued: IssuedRefreshToken): void {
    response.cookie(REFRESH_COOKIE, issued.token, {
      ...this.options(),
      expires: issued.expiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, this.options());
  }

  private options() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('REFRESH_COOKIE_SECURE') !== 'false',
      sameSite: 'strict' as const,
      path: this.config.get<string>('REFRESH_COOKIE_PATH') || '/auth',
    };
  }
}

@Injectable()
export class RefreshRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers[REFRESH_REQUEST_HEADER] !== '1') {
      throw new ForbiddenException('Requisição de sessão sem o cabeçalho obrigatório.');
    }
    return true;
  }
}
