import { Routes } from '@angular/router';
import { signedInGuard, signedOutGuard } from './core/session.guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tarefas' },
  {
    path: 'entrar',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'organizacoes',
    canActivate: [signedInGuard],
    loadComponent: () => import('./features/organizations/organizations.page').then((m) => m.OrganizationsPage),
  },
  {
    path: 'tarefas',
    canActivate: [signedInGuard],
    loadComponent: () => import('./features/tasks/tasks.page').then((m) => m.TasksPage),
  },
  {
    path: 'tarefas/nova',
    canActivate: [signedInGuard],
    loadComponent: () => import('./features/tasks/task-edit.page').then((m) => m.TaskEditPage),
  },
  {
    path: 'tarefas/:taskId',
    canActivate: [signedInGuard],
    loadComponent: () => import('./features/tasks/task-edit.page').then((m) => m.TaskEditPage),
  },
  {
    path: 'sincronizacao',
    canActivate: [signedInGuard],
    loadComponent: () => import('./features/sync/sync-issues.page').then((m) => m.SyncIssuesPage),
  },
  { path: '**', redirectTo: 'tarefas' },
];
