import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, Injector, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { PreloadAllModules, RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { API_BASE_URL } from './core/api-base-url';
import { authInterceptor } from './core/auth.interceptor';
import { CapacitorSecureStore, SecureStore } from './core/secure-store';
import { SESSION_USER_CHANGED } from './core/session.service';
import { IndexedDbStore } from './offline/local-store';
import { LOCAL_STORE, SyncService } from './offline/sync.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideIonicAngular({ mode: 'md' }),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    { provide: SecureStore, useClass: CapacitorSecureStore },
    { provide: LOCAL_STORE, useFactory: () => new IndexedDbStore() },
    {
      // Resolvido sob demanda para evitar dependência circular entre sessão e sincronização.
      provide: SESSION_USER_CHANGED,
      useFactory: () => {
        const injector = inject(Injector);
        return () => injector.get(SyncService).wipe();
      },
    },
  ],
};
