import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/** Armazenamento de segredos (refresh token). */
export abstract class SecureStore {
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string): Promise<void>;
  abstract remove(key: string): Promise<void>;
}

/**
 * No app nativo, usa o Keychain (iOS) e o Keystore (Android). No navegador,
 * usado só em desenvolvimento, guarda na sessionStorage da aba, que é apagada
 * ao fechá-la.
 */
@Injectable()
export class CapacitorSecureStore extends SecureStore {
  private readonly native = Capacitor.isNativePlatform();

  async get(key: string): Promise<string | null> {
    if (!this.native) return sessionStorage.getItem(key);
    try {
      return (await SecureStoragePlugin.get({ key })).value;
    } catch {
      return null; // chave inexistente
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.native) {
      sessionStorage.setItem(key, value);
      return;
    }
    await SecureStoragePlugin.set({ key, value });
  }

  async remove(key: string): Promise<void> {
    if (!this.native) {
      sessionStorage.removeItem(key);
      return;
    }
    try {
      await SecureStoragePlugin.remove({ key });
    } catch {
      // já ausente
    }
  }
}

/** Implementação em memória, para testes. */
export class MemorySecureStore extends SecureStore {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}
