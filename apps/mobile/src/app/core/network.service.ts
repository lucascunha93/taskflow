import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';

/** Estado da conexão do aparelho. No navegador, usa os eventos online/offline. */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly onlineState = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this.onlineState.asReadonly();
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor() {
    void Network.getStatus().then((status) => this.update(status.connected)).catch(() => undefined);
    void Network.addListener('networkStatusChange', (status) => this.update(status.connected)).catch(() => undefined);
  }

  /** Avisa quando a conexão muda; retorna a função que cancela o aviso. */
  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(online: boolean): void {
    if (online === this.onlineState()) return;
    this.onlineState.set(online);
    for (const listener of this.listeners) listener(online);
  }
}
