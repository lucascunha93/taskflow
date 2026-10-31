import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OrganizationsService } from './organizations.service';
import { DashboardComponent } from '../dashboard/dashboard.component';

@Component({
  selector: 'app-organization-home',
  imports: [RouterLink, DashboardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './organization-home.component.html',
  styleUrl: './organization-page.scss',
})
export class OrganizationHomeComponent {
  protected readonly organizations = inject(OrganizationsService);
  private readonly navigationInfo = inject(Router).currentNavigation()?.extras.info;
  protected readonly createdId =
    typeof this.navigationInfo === 'object' && this.navigationInfo !== null &&
    'createdOrganizationId' in this.navigationInfo && typeof this.navigationInfo.createdOrganizationId === 'string'
      ? this.navigationInfo.createdOrganizationId
      : null;
}
