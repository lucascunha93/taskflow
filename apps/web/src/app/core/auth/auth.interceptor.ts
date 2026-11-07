import { DOCUMENT } from '@angular/common';
import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { AuthService } from './auth.service';

/** Marca a repetição feita após um refresh, para nunca renovar duas vezes a mesma requisição. */
const RETRIED_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);
/** Endpoints que não usam o access token: autenticação pública e sessão via cookie. */
const SESSION_ENDPOINTS = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']);

const withToken = (request: HttpRequest<unknown>, token: string, retried = false) => request.clone({
  setHeaders: { Authorization: `Bearer ${token}` },
  context: retried ? request.context.set(RETRIED_AFTER_REFRESH, true) : request.context,
});

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const document = inject(DOCUMENT);
  const base = new URL(inject(API_BASE_URL) || '/', document.baseURI);
  const target = new URL(request.url, document.baseURI);
  const basePath = base.pathname.replace(/\/+$/, '');
  const relativePath = target.pathname.slice(basePath.length);
  const isApi = target.origin === base.origin &&
    (basePath === '' || target.pathname === basePath || target.pathname.startsWith(`${basePath}/`));
  const token = isApi && !SESSION_ENDPOINTS.has(relativePath) ? auth.getToken() : null;
  const generation = auth.getSessionVersion();

  return next(token ? withToken(request, token) : request).pipe(catchError((error: unknown) => {
    if (!token || !(error instanceof HttpErrorResponse) || error.status !== 401 ||
      request.context.get(RETRIED_AFTER_REFRESH)) {
      return throwError(() => error);
    }
    // Outra requisição já renovou o token durante esta: basta repetir com o atual.
    const current = auth.getToken();
    if (current && current !== token && auth.getSessionVersion() === generation) {
      return next(withToken(request, current, true));
    }
    // Access token expirado ou revogado: tenta renovar uma vez pelo cookie de refresh.
    return auth.refresh().pipe(
      catchError((refreshError: unknown) => {
        if (refreshError instanceof HttpErrorResponse && refreshError.status === 401 &&
          auth.expireSession(token, generation)) {
          void router.navigateByUrl('/login');
        }
        return throwError(() => error);
      }),
      switchMap((fresh) => auth.getSessionVersion() === generation
        ? next(withToken(request, fresh, true))
        : throwError(() => error)),
    );
  }));
};
