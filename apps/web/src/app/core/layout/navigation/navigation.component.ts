import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../../shared/icon/icon.component';

@Component({
  selector: 'app-navigation',
  imports: [IconComponent, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
  readonly navigated = output<void>();
  /** "Minhas tarefas" e "Todas as tarefas" compartilham /tasks e se distinguem pela query. */
  protected readonly exactMatch: IsActiveMatchOptions = {
    paths: 'exact', queryParams: 'exact', matrixParams: 'ignored', fragment: 'ignored',
  };
}
