import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, map, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api-base-url';
import { AuthService } from '../../core/auth/auth.service';
import { Organization, OrganizationRole } from './organization.models';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
const STORAGE_KEY = 'taskflow.activeOrganization';

function isRole(value: unknown): value is OrganizationRole {
  return value === 'OWNER' || value === 'ADMIN' || value === 'MEMBER';
}

function listFromResponse(value: unknown): Organization[] {
  if (!Array.isArray(value)) throw new Error('Resposta de organizações inválida.');
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null ||
      !('id' in item) || typeof item.id !== 'string' || !item.id ||
      !('name' in item) || typeof item.name !== 'string' || !item.name ||
      !('slug' in item) || typeof item.slug !== 'string' || !item.slug ||
      !('createdAt' in item) || typeof item.createdAt !== 'string' || !item.createdAt ||
      !('memberships' in item) || !Array.isArray(item.memberships) ||
      item.memberships.length !== 1) {
      throw new Error('Resposta de organizações inválida.');
    }
    const membership: unknown = item.memberships[0];
    if (typeof membership !== 'object' || membership === null ||
      !('role' in membership) || !isRole(membership.role)) {
      throw new Error('Resposta de associação inválida.');
    }
    return { id: item.id, name: item.name, slug: item.slug, createdAt: item.createdAt, role: membership.role };
  });
}

function organizationFromResponse(value: unknown): Organization {
  if (typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' || !value.id ||
    !('name' in value) || typeof value.name !== 'string' || !value.name ||
    !('slug' in value) || typeof value.slug !== 'string' || !value.slug ||
    !('createdAt' in value) || typeof value.createdAt !== 'string' || !value.createdAt ||
    !('role' in value) || !isRole(value.role)) {
    throw new Error('Resposta de organização inválida.');
  }
  return { id: value.id, name: value.name, slug: value.slug, createdAt: value.createdAt, role: value.role };
}

@Injectable({ providedIn: 'root' })
export class OrganizationsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly baseUrl = inject(API_BASE_URL).replace(/\/+$/, '');
  private readonly organizationsState = signal<Organization[]>([]);
  private readonly activeIdState = signal<string | null>(null);
  private readonly ownerIdState = signal<string | null>(null);
  private readonly statusState = signal<LoadStatus>('idle');
  private readonly warningState = signal('');
  private request: Subscription | null = null;
  private generation = 0;
  private mustClearStorage = false;

  readonly organizations = this.organizationsState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly warning = this.warningState.asReadonly();
  readonly active = computed(() => {
    if (this.auth.status() !== 'authenticated' || this.auth.user()?.id !== this.ownerIdState()) return null;
    return this.organizationsState().find((organization) => organization.id === this.activeIdState()) ?? null;
  });

  constructor() {
    this.auth.sessionEnded.subscribe(() => this.clear());
  }

  load(): void {
    if (this.statusState() === 'loading' || this.statusState() === 'ready') return;
    this.refresh();
  }

  refresh(): void {
    const user = this.auth.user();
    if (!user || this.auth.status() !== 'authenticated') return;
    this.request?.unsubscribe();
    const generation = ++this.generation;
    const sessionVersion = this.auth.getSessionVersion();
    this.ownerIdState.set(user.id);
    this.activeIdState.set(null);
    this.organizationsState.set([]);
    this.statusState.set('loading');
    this.request = this.http.get<unknown>(`${this.baseUrl}/organizations`).pipe(map(listFromResponse)).subscribe({
      next: (organizations) => {
        if (!this.isCurrent(generation, sessionVersion, user.id)) return;
        this.organizationsState.set(organizations);
        const saved = this.readSelection(user.id);
        const selected = organizations.find((organization) => organization.id === saved);
        if (selected) {
          this.activeIdState.set(selected.id);
        } else {
          if (saved) this.removeSelection();
          if (organizations.length === 1) this.select(organizations[0].id);
        }
        this.statusState.set('ready');
      },
      error: () => {
        if (!this.isCurrent(generation, sessionVersion, user.id)) return;
        this.organizationsState.set([]);
        this.activeIdState.set(null);
        this.statusState.set('error');
      },
    });
  }

  select(id: string): boolean {
    const user = this.auth.user();
    if (!user || this.auth.status() !== 'authenticated' || user.id !== this.ownerIdState() ||
      !this.organizationsState().some((organization) => organization.id === id)) return false;
    this.activeIdState.set(id);
    try {
      this.storage().setItem(STORAGE_KEY, JSON.stringify({ userId: user.id, organizationId: id }));
      this.warningState.set('');
    } catch {
      this.warningState.set('Não foi possível salvar a organização nesta aba. Selecione novamente ao recarregar.');
    }
    return true;
  }

  create(name: string): Observable<Organization> {
    const user = this.auth.user();
    if (!user || this.auth.status() !== 'authenticated' || this.statusState() !== 'ready' || this.ownerIdState() !== user.id) {
      return throwError(() => new Error('Não é possível criar uma organização sem uma sessão e lista válidas.'));
    }
    const sessionVersion = this.auth.getSessionVersion();
    const previousOrganizations = this.organizationsState();
    return this.http.post<unknown>(`${this.baseUrl}/organizations`, { name }).pipe(
      map(organizationFromResponse),
      tap((organization) => {
        if (this.auth.getSessionVersion() !== sessionVersion || this.auth.user()?.id !== user.id) {
          throw new Error('A sessão mudou durante a criação da organização.');
        }
        const refreshInProgress = this.statusState() === 'loading';
        const currentOrganizations = refreshInProgress ? previousOrganizations : this.organizationsState();
        this.request?.unsubscribe();
        this.generation++;
        this.organizationsState.set([organization, ...currentOrganizations.filter((item) => item.id !== organization.id)]);
        this.statusState.set('ready');
        this.select(organization.id);
        if (refreshInProgress) this.refresh();
      }),
    );
  }

  /** Renomeia uma organização; a API valida se o usuário é OWNER ou ADMIN. */
  rename(id: string, name: string): Observable<Organization> {
    const user = this.auth.user();
    if (!user || this.auth.status() !== 'authenticated' || this.ownerIdState() !== user.id ||
      !this.organizationsState().some((organization) => organization.id === id)) {
      return throwError(() => new Error('Não é possível alterar uma organização fora da sessão atual.'));
    }
    const sessionVersion = this.auth.getSessionVersion();
    return this.http.patch<unknown>(`${this.baseUrl}/organizations/${encodeURIComponent(id)}`, { name }).pipe(
      map(organizationFromResponse),
      tap((organization) => {
        if (this.auth.getSessionVersion() !== sessionVersion || this.auth.user()?.id !== user.id ||
          organization.id !== id) {
          throw new Error('A sessão mudou durante a alteração da organização.');
        }
        this.organizationsState.update((organizations) =>
          organizations.map((item) => item.id === organization.id ? organization : item));
      }),
    );
  }

  private isCurrent(generation: number, sessionVersion: number, userId: string): boolean {
    return generation === this.generation && sessionVersion === this.auth.getSessionVersion() &&
      this.auth.status() === 'authenticated' && this.auth.user()?.id === userId;
  }

  private readSelection(userId: string): string | null {
    let raw: string | null;
    try {
      if (this.mustClearStorage) {
        this.storage().removeItem(STORAGE_KEY);
        this.mustClearStorage = false;
      }
      raw = this.storage().getItem(STORAGE_KEY);
    } catch {
      this.warningState.set('Não foi possível restaurar a organização salva nesta aba.');
      return null;
    }
    if (!raw) return null;
    try {
      const saved: unknown = JSON.parse(raw);
      if (typeof saved === 'object' && saved !== null &&
        'userId' in saved && saved.userId === userId &&
        'organizationId' in saved && typeof saved.organizationId === 'string') {
        return saved.organizationId;
      }
      this.removeSelection();
      return null;
    } catch {
      this.warningState.set('Não foi possível restaurar a organização salva nesta aba.');
      this.removeSelection();
      return null;
    }
  }

  private clear(): void {
    this.generation++;
    this.request?.unsubscribe();
    this.request = null;
    this.organizationsState.set([]);
    this.activeIdState.set(null);
    this.ownerIdState.set(null);
    this.statusState.set('idle');
    this.removeSelection();
  }

  private removeSelection(): void {
    try {
      this.storage().removeItem(STORAGE_KEY);
      this.mustClearStorage = false;
    } catch {
      this.mustClearStorage = true;
      this.warningState.set('Não foi possível limpar a organização salva nesta aba.');
    }
  }

  private storage(): Storage {
    const storage = this.document.defaultView?.sessionStorage;
    if (!storage) throw new Error('Armazenamento de sessão indisponível.');
    return storage;
  }
}
