import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconComponent, type IconName } from '../../../shared/icon/icon.component';

interface NavigationItem {
  label: string;
  icon: IconName;
}

@Component({
  selector: 'app-navigation',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
  protected readonly workspaceItems: readonly NavigationItem[] = [
    { label: 'Dashboard', icon: 'dashboard' },
    { label: 'Minhas tarefas', icon: 'my-tasks' },
    { label: 'Todas as tarefas', icon: 'tasks' },
    { label: 'Membros', icon: 'members' },
  ];
}
