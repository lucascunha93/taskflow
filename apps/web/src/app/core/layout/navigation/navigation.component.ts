import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent, type IconName } from '../../../shared/icon/icon.component';

interface NavigationItem {
  label: string;
  icon: IconName;
}

@Component({
  selector: 'app-navigation',
  imports: [IconComponent, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
  readonly navigated = output<void>();
  protected readonly workspaceItems: readonly NavigationItem[] = [
    { label: 'Dashboard', icon: 'dashboard' },
    { label: 'Minhas tarefas', icon: 'my-tasks' },
    { label: 'Todas as tarefas', icon: 'tasks' },
  ];
}
