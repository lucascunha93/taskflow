import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonNote, IonTitle, IonToolbar,
} from '@ionic/angular';
import { LogoutService } from '../../core/logout.service';
import { SyncService } from '../../offline/sync.service';

const ROLE_LABELS = { OWNER: 'Proprietário', ADMIN: 'Administrador', MEMBER: 'Membro' } as const;

@Component({
  selector: 'app-organizations',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, IonList, IonItem, IonLabel, IonNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Organizações</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="logout.confirm()" aria-label="Sair"><ion-icon slot="icon-only" name="log-out-outline" /></ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      @if (sync.organizations().length === 0) {
        <p class="empty-state">
          @if (sync.state() === 'offline') {
            Sem conexão. Conecte-se para carregar suas organizações.
          } @else {
            Você ainda não participa de nenhuma organização. Crie ou peça um convite pela web.
          }
        </p>
      } @else {
        <ion-list>
          @for (organization of sync.organizations(); track organization.id) {
            <ion-item button detail (click)="choose(organization.id)"
              [attr.aria-current]="organization.id === sync.activeOrganization()?.id ? 'true' : null">
              <ion-icon slot="start" name="business-outline" />
              <ion-label>
                <h2>{{ organization.name }}</h2>
                <ion-note>{{ roles[organization.role] }}</ion-note>
              </ion-label>
            </ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
})
export class OrganizationsPage {
  protected readonly sync = inject(SyncService);
  protected readonly logout = inject(LogoutService);
  private readonly router = inject(Router);
  protected readonly roles = ROLE_LABELS;

  protected async choose(organizationId: string): Promise<void> {
    await this.sync.selectOrganization(organizationId);
    await this.router.navigate(['/tarefas'], { replaceUrl: true });
  }
}
