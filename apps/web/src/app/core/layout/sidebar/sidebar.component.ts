import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AuthUser } from '../../auth/auth.models';
import { BrandComponent } from '../../../shared/brand/brand.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { OrganizationSelectorComponent } from '../../../features/organizations/organization-selector.component';

@Component({
  selector: 'app-sidebar',
  imports: [NavigationComponent, BrandComponent, OrganizationSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly user = input.required<AuthUser>();
}
