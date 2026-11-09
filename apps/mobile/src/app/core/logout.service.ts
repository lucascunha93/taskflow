import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { SyncService } from '../offline/sync.service';
import { SessionService } from './session.service';

/**
 * Sair apaga os dados do aparelho, inclusive alterações não enviadas. Com
 * alterações pendentes, o app tenta sincronizar e pede confirmação antes.
 */
@Injectable({ providedIn: 'root' })
export class LogoutService {
  private readonly session = inject(SessionService);
  private readonly sync = inject(SyncService);
  private readonly alerts = inject(AlertController);
  private readonly router = inject(Router);

  async confirm(): Promise<void> {
    await this.sync.sync();
    const unsent = await this.sync.unsentCount();
    const alert = await this.alerts.create({
      header: 'Sair do TaskFlow?',
      message: unsent > 0
        ? `${unsent} alteração(ões) ainda não foram enviadas e serão perdidas. Conecte-se e aguarde a sincronização para mantê-las.`
        : 'Os dados guardados neste aparelho serão apagados.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: unsent > 0 ? 'Sair e descartar' : 'Sair', role: 'destructive', handler: () => void this.signOut() },
      ],
    });
    await alert.present();
  }

  private async signOut(): Promise<void> {
    await this.session.logout();
    await this.router.navigate(['/entrar'], { replaceUrl: true });
  }
}
