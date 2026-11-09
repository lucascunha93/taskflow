import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { SessionOfflineError, SessionService } from './session.service';

/**
 * Adiciona o access token às chamadas da API e, diante de um 401, renova a
 * sessão uma vez e repete a requisição. Se a renovação falhar, o erro original
 * segue para quem chamou.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);
  const withToken = (token: string) => request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  return from(session.token()).pipe(
    // Sem rede, a falha é temporária (status 0); com a sessão encerrada, é 401.
    catchError((error: unknown) => throwError(() => new HttpErrorResponse({
      status: error instanceof SessionOfflineError ? 0 : 401, statusText: 'Sessão indisponível', url: request.url,
    }))),
    switchMap((token) => next(withToken(token)).pipe(
      catchError((error: unknown) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);
        return from(session.refresh()).pipe(
          catchError((refreshError: unknown) => throwError(() => refreshError instanceof SessionOfflineError
            ? new HttpErrorResponse({ status: 0, statusText: 'Sem conexão', url: request.url })
            : error)),
          switchMap((fresh) => next(withToken(fresh))),
        );
      }),
    )),
  );
};
