import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AuthUser } from '../../auth/auth.models';
import { BrandComponent } from '../../../shared/brand/brand.component';
import { IconComponent } from '../../../shared/icon/icon.component';
import { NavigationComponent } from '../navigation/navigation.component';

@Component({
  selector: 'app-sidebar',
  imports: [IconComponent, NavigationComponent, BrandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly user = input.required<AuthUser>();
}
