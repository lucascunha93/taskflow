import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { SessionService } from './session.service';

/** Espera a sessão ser restaurada antes de decidir a navegação. */
function whenReady<T>(decide: (session: SessionService) => T) {
  const session = inject(SessionService);
  return toObservable(session.status).pipe(
    filter((status) => status !== 'starting'),
    take(1),
    map(() => decide(session)),
  );
}

export const signedInGuard: CanActivateFn = () => {
  const router = inject(Router);
  return whenReady((session) => session.signedIn() || router.createUrlTree(['/entrar']));
};

export const signedOutGuard: CanActivateFn = () => {
  const router = inject(Router);
  return whenReady((session) => !session.signedIn() || router.createUrlTree(['/tarefas']));
};
