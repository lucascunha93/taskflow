import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  add, alertCircleOutline, businessOutline, checkmarkCircleOutline, cloudOfflineOutline, logOutOutline,
  syncOutline, timeOutline, trashOutline,
} from 'ionicons/icons';
import { SessionService } from './core/session.service';
import { SyncService } from './offline/sync.service';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ion-app><ion-router-outlet /></ion-app>`,
})
export class App {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  constructor() {
    addIcons({
      add, alertCircleOutline, businessOutline, checkmarkCircleOutline, cloudOfflineOutline, logOutOutline,
      syncOutline, timeOutline, trashOutline,
    });
    // Instancia a sincronização para que ela reaja à sessão desde o início.
    inject(SyncService);
    void this.session.start();
    // Sessão expirada durante o uso: volta ao login, mantendo a fila no aparelho.
    effect(() => {
      if (this.session.status() === 'signed-out' && !this.router.url.startsWith('/entrar')) {
        void this.router.navigate(['/entrar']);
      }
    });
  }
}
