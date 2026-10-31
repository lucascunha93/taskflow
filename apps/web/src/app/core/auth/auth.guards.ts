import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restoreSession().pipe(map((status) => {
    if (status === 'authenticated') return true;
    return router.parseUrl(status === 'error' ? '/session-error' : '/login');
  }));
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.restoreSession().pipe(map((status) => {
    if (status === 'unauthenticated') return true;
    return router.parseUrl(status === 'error' ? '/session-error' : '/');
  }));
};

export const sessionErrorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.status() === 'error') return true;
  return auth.restoreSession().pipe(map((status) => {
    if (status === 'error') return true;
    return router.parseUrl(status === 'authenticated' ? '/' : '/login');
  }));
};
