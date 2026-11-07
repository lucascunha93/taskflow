import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon.component';
import { OrganizationsService } from '../organizations/organizations.service';
import { AppNotification, describeNotification } from './notification.models';
import { NotificationsService } from './notifications.service';

@Component({
  selector: 'app-notifications-menu',
  imports: [DatePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications-menu.component.html',
  styleUrl: './notifications-menu.component.scss',
})
export class NotificationsMenuComponent {
  protected readonly notifications = inject(NotificationsService);
  private readonly organizations = inject(OrganizationsService);
  private readonly router = inject(Router);
  private readonly menu = viewChild.required<ElementRef<HTMLDetailsElement>>('menu');
  protected readonly message = signal('');
  protected readonly markingAll = signal(false);
  protected readonly describe = describeNotification;

  protected toggled(): void {
    this.message.set('');
    if (this.menu().nativeElement.open) this.notifications.refresh();
  }

  /** Abre a tarefa na organização da notificação, trocando o contexto se necessário. */
  protected open(notification: AppNotification): void {
    this.notifications.markRead(notification);
    if (!notification.taskId) return;
    if (this.organizations.active()?.id !== notification.organizationId &&
      !this.organizations.select(notification.organizationId)) {
      this.message.set('Esta organização não está mais disponível para você.');
      return;
    }
    this.menu().nativeElement.open = false;
    void this.router.navigate(['/tasks'], { queryParams: { task: notification.taskId } });
  }

  protected markAll(): void {
    if (this.markingAll()) return;
    this.markingAll.set(true);
    this.notifications.markAllRead().subscribe({
      next: () => this.markingAll.set(false),
      error: () => {
        this.markingAll.set(false);
        this.message.set('Não foi possível marcar as notificações como lidas.');
      },
    });
  }
}
