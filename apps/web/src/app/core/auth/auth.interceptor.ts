import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../api-base-url';
import { AuthService } from './auth.service';

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
  const isPublicAuth = relativePath === '/auth/login' || relativePath === '/auth/register';
  const token = isApi && !isPublicAuth ? auth.getToken() : null;
  const generation = auth.getSessionVersion();
  const authorized = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorized).pipe(catchError((error: unknown) => {
    if (token && error instanceof HttpErrorResponse && error.status === 401 && auth.expireSession(token, generation)) {
      void router.navigateByUrl('/login');
    }
    return throwError(() => error);
  }));
};
