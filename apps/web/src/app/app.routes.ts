import { Routes } from '@angular/router';
import { authGuard, guestGuard, sessionErrorGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/authentication/login.component').then((m) => m.LoginComponent) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/authentication/register.component').then((m) => m.RegisterComponent) },
  { path: 'session-error', canActivate: [sessionErrorGuard], loadComponent: () => import('./features/authentication/session-error.component').then((m) => m.SessionErrorComponent) },
  { path: '', pathMatch: 'full', canActivate: [authGuard], loadComponent: () => import('./core/layout/main-layout.component').then((m) => m.MainLayoutComponent) },
  { path: '**', redirectTo: '' },
];
