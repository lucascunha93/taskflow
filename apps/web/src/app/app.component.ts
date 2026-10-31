import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { OrganizationsService } from './features/organizations/organizations.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.component.scss',
  templateUrl: './app.component.html',
})
export class App {
  protected readonly auth = inject(AuthService);

  constructor() {
    inject(OrganizationsService);
  }
}
