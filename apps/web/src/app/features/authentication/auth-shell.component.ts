import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandComponent } from '../../shared/brand/brand.component';

@Component({
  selector: 'app-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-shell">
      <a class="brand" routerLink="/login" aria-label="TaskFlow — início">
        <app-brand />
      </a>
      <section class="panel"><ng-content /></section>
      <p class="footer">TaskFlow · Trabalho em equipe, com clareza.</p>
    </main>
  `,
  imports: [RouterLink, BrandComponent],
  styleUrl: './auth-shell.component.scss',
})
export class AuthShellComponent {}
