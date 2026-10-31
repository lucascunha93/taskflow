import { Routes } from '@angular/router';
import { authGuard, guestGuard, sessionErrorGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/authentication/login.component').then((m) => m.LoginComponent) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/authentication/register.component').then((m) => m.RegisterComponent) },
  { path: 'session-error', canActivate: [sessionErrorGuard], loadComponent: () => import('./features/authentication/session-error.component').then((m) => m.SessionErrorComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./core/layout/main-layout.component').then((m) => m.MainLayoutComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/organizations/organization-home.component').then((m) => m.OrganizationHomeComponent) },
      { path: 'organizations/new', loadComponent: () => import('./features/organizations/create-organization.component').then((m) => m.CreateOrganizationComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
